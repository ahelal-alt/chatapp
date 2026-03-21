const { body, param, query } = require('express-validator');
const { isValidUrlOrUploadPath } = require('../../utils/validation');

const sendMessageValidation = [
  body('chatId').isMongoId().withMessage('chatId is required'),
  body('type').optional().isIn(['text', 'image', 'video', 'audio', 'file', 'voice', 'location']),
  body('clientMessageId').optional().isString().isLength({ min: 1, max: 120 }),
  body('text').optional().isString(),
  body('mimeType').optional().isString().isLength({ min: 1, max: 120 }),
  body('fileName').optional().isString().isLength({ min: 1, max: 255 }),
  body('fileSize').optional().isInt({ min: 0, max: 1024 * 1024 * 100 }),
  body('duration').optional().isFloat({ min: 0, max: 60 * 60 * 4 }),
  body('width').optional().isInt({ min: 1, max: 20000 }),
  body('height').optional().isInt({ min: 1, max: 20000 }),
  body('aspectRatio').optional().isFloat({ min: 0.01, max: 100 }),
  body('pages').optional().isInt({ min: 1, max: 100000 }),
  body('extension').optional().isString().isLength({ min: 1, max: 20 }),
  body('metadataProcessingStatus').optional().isIn(['pending', 'complete', 'partial', 'failed', 'unsupported', 'legacy']),
  body('mediaUrl')
    .optional()
    .custom((value) => isValidUrlOrUploadPath(value))
    .withMessage('mediaUrl must be a valid URL or uploaded file path'),
  body('thumbnailUrl')
    .optional()
    .custom((value) => isValidUrlOrUploadPath(value))
    .withMessage('thumbnailUrl must be a valid URL or uploaded file path'),
  body('isEncrypted').optional().isBoolean(),
  body('ciphertext').optional().isString().isLength({ min: 1, max: 500000 }),
  body('ciphertextIv').optional().isString().isLength({ min: 1, max: 1000 }),
  body('encryptionVersion').optional().isInt({ min: 1, max: 10 }),
  body('encryptedKeys').optional().isArray({ min: 1 }),
  body('replyToMessageId').optional().isMongoId().withMessage('replyToMessageId must be a valid message id'),
  body('forwardedFromMessageId').optional().isMongoId().withMessage('forwardedFromMessageId must be a valid message id'),
  body('latitude').optional().isFloat(),
  body('longitude').optional().isFloat(),
];

const chatMessageListValidation = [
  param('chatId').isMongoId().withMessage('Invalid chat id'),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

const chatSharedFilesValidation = [
  param('chatId').isMongoId().withMessage('Invalid chat id'),
  query('kind').optional().isIn(['all', 'image', 'video', 'audio', 'document', 'other']),
  query('senderId').optional().isMongoId().withMessage('Invalid sender id'),
  query('q').optional().trim().isLength({ min: 1, max: 80 }),
  query('from').optional().isISO8601().withMessage('from must be a valid date'),
  query('to').optional().isISO8601().withMessage('to must be a valid date'),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

const sharedFilesValidation = [
  query('kind').optional().isIn(['all', 'image', 'video', 'audio', 'document', 'other']),
  query('chatId').optional().isMongoId().withMessage('Invalid chat id'),
  query('senderId').optional().isMongoId().withMessage('Invalid sender id'),
  query('q').optional().trim().isLength({ min: 1, max: 80 }),
  query('from').optional().isISO8601().withMessage('from must be a valid date'),
  query('to').optional().isISO8601().withMessage('to must be a valid date'),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

const messageIdValidation = [
  param('messageId').isMongoId().withMessage('Invalid message id'),
];

const mediaDetailsValidation = [
  ...messageIdValidation,
];

const messageSearchValidation = [
  param('chatId').isMongoId().withMessage('Invalid chat id'),
  query('q')
    .trim()
    .isLength({ min: 1, max: 80 })
    .withMessage('q must be between 1 and 80 characters'),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
];

const editMessageValidation = [
  ...messageIdValidation,
  body('text').trim().notEmpty().withMessage('text is required'),
];

const reactionValidation = [
  ...messageIdValidation,
  body('emoji').trim().notEmpty().withMessage('emoji is required'),
];

module.exports = {
  sendMessageValidation,
  chatMessageListValidation,
  chatSharedFilesValidation,
  sharedFilesValidation,
  messageIdValidation,
  mediaDetailsValidation,
  messageSearchValidation,
  editMessageValidation,
  reactionValidation,
};
