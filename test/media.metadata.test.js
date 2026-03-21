const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const childProcess = require('node:child_process');

const env = require('../src/config/env');
const { processUploadedAsset } = require('../src/utils/media');

const uploadRoot = path.resolve(process.cwd(), env.uploadDir);

function ensureUploadRoot() {
  fs.mkdirSync(uploadRoot, { recursive: true });
}

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    // Ignore cleanup failures in tests.
  }
}

function createPngBuffer(width, height) {
  const buffer = Buffer.alloc(24);
  buffer.writeUInt8(0x89, 0);
  buffer.write('PNG', 1, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function createWavBuffer(durationSeconds = 1) {
  const sampleRate = 8000;
  const channels = 1;
  const bitsPerSample = 8;
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const dataSize = byteRate * durationSeconds;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(channels * bitsPerSample / 8, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

test('image uploads get width, height, aspect ratio, and complete status', async () => {
  ensureUploadRoot();
  const filename = 'test-image.png';
  const filePath = path.join(uploadRoot, filename);
  fs.writeFileSync(filePath, createPngBuffer(320, 180));

  try {
    const asset = await processUploadedAsset({
      filename,
      originalname: 'photo.png',
      mimetype: 'image/png',
      size: fs.statSync(filePath).size,
    });

    assert.equal(asset.mediaKind, 'image');
    assert.equal(asset.width, 320);
    assert.equal(asset.height, 180);
    assert.equal(asset.aspectRatio, Number((320 / 180).toFixed(4)));
    assert.equal(asset.thumbnailUrl, asset.url);
    assert.equal(asset.metadataProcessingStatus, 'complete');
  } finally {
    removeIfExists(filePath);
  }
});

test('wav uploads get duration metadata', async () => {
  ensureUploadRoot();
  const filename = 'test-audio.wav';
  const filePath = path.join(uploadRoot, filename);
  fs.writeFileSync(filePath, createWavBuffer(1));

  try {
    const asset = await processUploadedAsset({
      filename,
      originalname: 'voice.wav',
      mimetype: 'audio/wav',
      size: fs.statSync(filePath).size,
    });

    assert.equal(asset.mediaKind, 'audio');
    assert.equal(asset.duration, 1);
    assert.equal(asset.metadataProcessingStatus, 'complete');
  } finally {
    removeIfExists(filePath);
  }
});

test('video uploads use ffprobe metadata when available', async () => {
  ensureUploadRoot();
  const filename = 'test-video.mp4';
  const filePath = path.join(uploadRoot, filename);
  fs.writeFileSync(filePath, Buffer.from('fake video'));

  const originalExecFile = childProcess.execFile;
  childProcess.execFile = (_command, _args, _options, callback) => {
    callback(null, JSON.stringify({
      streams: [
        {
          codec_type: 'video',
          width: 1920,
          height: 1080,
        },
      ],
      format: {
        duration: '3.5',
      },
    }));
  };

  try {
    const asset = await processUploadedAsset({
      filename,
      originalname: 'clip.mp4',
      mimetype: 'video/mp4',
      size: fs.statSync(filePath).size,
    });

    assert.equal(asset.mediaKind, 'video');
    assert.equal(asset.width, 1920);
    assert.equal(asset.height, 1080);
    assert.equal(asset.duration, 3.5);
    assert.equal(asset.metadataProcessingStatus, 'complete');
  } finally {
    childProcess.execFile = originalExecFile;
    removeIfExists(filePath);
  }
});
