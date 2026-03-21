const fs = require('fs');
const path = require('path');
const childProcess = require('node:child_process');
const env = require('../config/env');

function normalizeUploadPath(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.replace(/\\/g, '/').trim();
  if (!normalized) {
    return '';
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function getExtension(fileName = '') {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  return ext.startsWith('.') ? ext.slice(1) : ext;
}

function getMediaKindFromMime(mimeType = '') {
  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  if (mimeType.startsWith('video/')) {
    return 'video';
  }
  if (mimeType.startsWith('audio/')) {
    return 'audio';
  }
  if (mimeType === 'application/pdf'
    || mimeType.includes('document')
    || mimeType.includes('sheet')
    || mimeType.includes('presentation')
    || mimeType.startsWith('text/')) {
    return 'document';
  }

  return 'other';
}

function isPreviewableMediaKind(mediaKind, mimeType = '') {
  return ['image', 'video', 'audio'].includes(mediaKind) || mimeType === 'application/pdf';
}

function buildBasicUploadedAsset(file) {
  const relativePath = normalizeUploadPath(`${env.uploadDir}/${file.filename}`);
  const mimeType = file.mimetype || '';
  const mediaKind = getMediaKindFromMime(mimeType);
  const extension = getExtension(file.originalname || file.filename || '');
  const previewable = isPreviewableMediaKind(mediaKind, mimeType);

  return {
    url: relativePath,
    path: relativePath,
    previewUrl: relativePath,
    thumbnailUrl: mediaKind === 'image' ? relativePath : '',
    mimeType,
    fileName: file.originalname,
    fileSize: file.size,
    mediaKind,
    previewable,
    extension,
    width: null,
    height: null,
    aspectRatio: null,
    duration: 0,
    pages: null,
    metadataProcessingStatus: previewable || mediaKind === 'document' ? 'pending' : 'unsupported',
  };
}

async function readFileBuffer(filePath) {
  return fs.promises.readFile(filePath);
}

function parsePngSize(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function parseGifSize(buffer) {
  if (buffer.length < 10 || buffer.toString('ascii', 0, 3) !== 'GIF') {
    return null;
  }
  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
  };
}

function parseWebpSize(buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }

  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType === 'VP8X' && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }

  return null;
}

function parseJpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    if (!marker || marker === 0xda || marker === 0xd9) {
      break;
    }

    const size = buffer.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + size;
  }

  return null;
}

async function extractImageMetadata(filePath) {
  const buffer = await readFileBuffer(filePath);
  return parsePngSize(buffer)
    || parseGifSize(buffer)
    || parseWebpSize(buffer)
    || parseJpegSize(buffer);
}

async function extractWavDuration(filePath) {
  const buffer = await readFileBuffer(filePath);
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }

  let offset = 12;
  let byteRate = null;
  let dataSize = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkId === 'fmt ' && chunkSize >= 8) {
      byteRate = buffer.readUInt32LE(chunkStart + 8);
    }
    if (chunkId === 'data') {
      dataSize = chunkSize;
      break;
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (!byteRate || !dataSize) {
    return null;
  }

  return Number((dataSize / byteRate).toFixed(3));
}

async function extractPdfPages(filePath) {
  const buffer = await readFileBuffer(filePath);
  const content = buffer.toString('latin1');
  const matches = content.match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : null;
}

async function ffprobeMetadata(filePath) {
  try {
    const stdout = await new Promise((resolve, reject) => {
      childProcess.execFile('ffprobe', [
        '-v', 'error',
        '-print_format', 'json',
        '-show_streams',
        '-show_format',
        filePath,
      ], {
        timeout: 3000,
        maxBuffer: 1024 * 1024,
      }, (error, out) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(out);
      });
    });

    const parsed = JSON.parse(stdout || '{}');
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const format = parsed.format || {};
    const videoStream = streams.find((stream) => stream.codec_type === 'video');
    const audioStream = streams.find((stream) => stream.codec_type === 'audio');
    const durationRaw = format.duration || videoStream?.duration || audioStream?.duration || null;

    return {
      width: Number(videoStream?.width) || null,
      height: Number(videoStream?.height) || null,
      duration: durationRaw ? Number(Number(durationRaw).toFixed(3)) : null,
    };
  } catch (error) {
    return null;
  }
}

function finalizeMetadata(asset) {
  if (asset.width && asset.height && !asset.aspectRatio) {
    asset.aspectRatio = Number((asset.width / asset.height).toFixed(4));
  }

  if (!asset.thumbnailUrl && asset.mediaKind === 'image') {
    asset.thumbnailUrl = asset.previewUrl;
  }

  return asset;
}

async function enrichImageAsset(asset, absolutePath) {
  const size = await extractImageMetadata(absolutePath);
  if (size) {
    asset.width = size.width;
    asset.height = size.height;
    asset.metadataProcessingStatus = 'complete';
  } else {
    asset.metadataProcessingStatus = 'partial';
  }

  return finalizeMetadata(asset);
}

async function enrichAudioAsset(asset, absolutePath) {
  let duration = null;
  if (asset.mimeType === 'audio/wav' || asset.mimeType === 'audio/x-wav') {
    duration = await extractWavDuration(absolutePath);
  }
  if (duration === null) {
    const probe = await ffprobeMetadata(absolutePath);
    duration = probe?.duration ?? null;
  }

  if (duration !== null) {
    asset.duration = duration;
    asset.metadataProcessingStatus = 'complete';
  } else {
    asset.metadataProcessingStatus = 'partial';
  }

  return finalizeMetadata(asset);
}

async function enrichVideoAsset(asset, absolutePath) {
  const probe = await ffprobeMetadata(absolutePath);
  if (probe) {
    asset.width = probe.width;
    asset.height = probe.height;
    asset.duration = probe.duration || 0;
    asset.metadataProcessingStatus = (probe.width || probe.height || probe.duration)
      ? 'complete'
      : 'partial';
  } else {
    asset.metadataProcessingStatus = 'partial';
  }

  return finalizeMetadata(asset);
}

async function enrichDocumentAsset(asset, absolutePath) {
  if (asset.mimeType === 'application/pdf') {
    asset.pages = await extractPdfPages(absolutePath);
    asset.metadataProcessingStatus = asset.pages ? 'complete' : 'partial';
    asset.previewable = true;
  } else {
    asset.metadataProcessingStatus = 'unsupported';
  }

  return finalizeMetadata(asset);
}

async function processUploadedAsset(file) {
  const asset = buildBasicUploadedAsset(file);
  const absolutePath = path.resolve(process.cwd(), env.uploadDir, file.filename);

  try {
    if (asset.mediaKind === 'image') {
      return await enrichImageAsset(asset, absolutePath);
    }
    if (asset.mediaKind === 'audio') {
      return await enrichAudioAsset(asset, absolutePath);
    }
    if (asset.mediaKind === 'video') {
      return await enrichVideoAsset(asset, absolutePath);
    }
    if (asset.mediaKind === 'document') {
      return await enrichDocumentAsset(asset, absolutePath);
    }
    return finalizeMetadata(asset);
  } catch (error) {
    return {
      ...asset,
      metadataProcessingStatus: 'failed',
    };
  }
}

function normalizeMediaMetadata(record) {
  const mimeType = record.mimeType || '';
  const mediaKind = record.mediaKind || getMediaKindFromMime(mimeType);
  const previewable = record.previewable !== undefined
    ? Boolean(record.previewable)
    : isPreviewableMediaKind(mediaKind, mimeType);
  const previewUrl = record.previewUrl || record.mediaUrl || record.url || '';
  const thumbnailUrl = record.thumbnailUrl || (mediaKind === 'image' ? previewUrl : '');
  const width = Number.isFinite(record.width) ? record.width : null;
  const height = Number.isFinite(record.height) ? record.height : null;
  const aspectRatio = Number.isFinite(record.aspectRatio)
    ? record.aspectRatio
    : (width && height ? Number((width / height).toFixed(4)) : null);

  return {
    mediaKind,
    previewable,
    previewUrl,
    thumbnailUrl,
    width,
    height,
    aspectRatio,
    duration: Number(record.duration || 0),
    extension: record.extension || getExtension(record.fileName || ''),
    pages: Number.isFinite(record.pages) ? record.pages : null,
    metadataProcessingStatus: record.metadataProcessingStatus || 'legacy',
  };
}

module.exports = {
  normalizeUploadPath,
  getExtension,
  getMediaKindFromMime,
  isPreviewableMediaKind,
  buildBasicUploadedAsset,
  processUploadedAsset,
  normalizeMediaMetadata,
};
