const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuid } = require('uuid');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

const uploadRoot = path.resolve(process.cwd(), env.uploadDir);
fs.mkdirSync(uploadRoot, { recursive: true });

const mimeExtensionMap = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'video/mp4': ['mp4'],
  'audio/mpeg': ['mp3'],
  'audio/mp4': ['m4a', 'mp4'],
  'audio/webm': ['webm'],
  'audio/ogg': ['ogg'],
  'audio/wav': ['wav'],
  'audio/x-wav': ['wav'],
  'audio/x-m4a': ['m4a'],
  'audio/aac': ['aac'],
  'application/pdf': ['pdf'],
  'application/zip': ['zip'],
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadRoot);
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname);
    cb(null, `${uuid()}${extension}`);
  },
});

function createUpload(allowedMimeTypes) {
  return multer({
    storage,
    limits: {
      fileSize: env.maxFileSizeMb * 1024 * 1024,
    },
    fileFilter: (req, file, cb) => {
      if (!allowedMimeTypes.includes(file.mimetype)) {
        return cb(new ApiError(400, 'Unsupported file type'));
      }

      const extension = path.extname(file.originalname || '').replace('.', '').toLowerCase();
      const allowedExtensions = mimeExtensionMap[file.mimetype] || [];

      if (allowedExtensions.length && !allowedExtensions.includes(extension)) {
        return cb(new ApiError(400, 'File extension does not match the declared file type'));
      }

      return cb(null, true);
    },
  });
}

const imageMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

const chatMediaMimeTypes = [
  ...imageMimeTypes,
  'video/mp4',
  'audio/mpeg',
  'audio/mp4',
  'audio/webm',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/x-m4a',
  'audio/aac',
  'application/pdf',
  'application/zip',
];

module.exports = {
  uploadProfileImage: createUpload(imageMimeTypes),
  uploadChatMedia: createUpload(chatMediaMimeTypes),
};
