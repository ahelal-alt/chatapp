const env = require('../config/env');

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch (error) {
    return false;
  }
}

function isValidUploadedFilePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    return false;
  }

  const normalized = value.replace(/\\/g, '/');
  return normalized.startsWith(`/${env.uploadDir}/`);
}

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

function buildUploadedAsset(file) {
  const relativePath = normalizeUploadPath(`${env.uploadDir}/${file.filename}`);
  const mimeType = file.mimetype || '';
  const mediaKind = mimeType.startsWith('image/')
    ? 'image'
    : mimeType.startsWith('video/')
      ? 'video'
      : mimeType.startsWith('audio/')
        ? 'audio'
        : (mimeType === 'application/pdf'
          || mimeType.includes('document')
          || mimeType.includes('sheet')
          || mimeType.includes('presentation')
          || mimeType.startsWith('text/'))
          ? 'document'
          : 'other';

  return {
    url: relativePath,
    path: relativePath,
    previewUrl: relativePath,
    mimeType,
    fileName: file.originalname,
    fileSize: file.size,
    mediaKind,
    previewable: ['image', 'video', 'audio'].includes(mediaKind),
  };
}

function isValidUrlOrUploadPath(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  return isValidHttpUrl(normalized) || isValidUploadedFilePath(normalized);
}

module.exports = {
  escapeRegex,
  isValidHttpUrl,
  isValidUploadedFilePath,
  isValidUrlOrUploadPath,
  normalizeUploadPath,
  buildUploadedAsset,
};
