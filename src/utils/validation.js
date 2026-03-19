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

  return {
    url: relativePath,
    path: relativePath,
    previewUrl: relativePath,
    mimeType: file.mimetype,
    fileName: file.originalname,
    fileSize: file.size,
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
