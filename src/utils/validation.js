const env = require('../config/env');
const { buildBasicUploadedAsset, normalizeUploadPath } = require('./media');

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

function buildUploadedAsset(file) {
  return buildBasicUploadedAsset(file);
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
