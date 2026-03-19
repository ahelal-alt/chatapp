const { body, param, query } = require('express-validator');
const { isValidUrlOrUploadPath } = require('../../utils/validation');

const sendMessageValidation = [
  body('chatId').isMongoId().withMessage('chatId is required'),
  body('type').optional().isIn(['text', 'image', 'video', 'audio', 'file', 'voice', 'location']),
  body('text').optional().isString(),
  body('mediaUrl')
    .optional()
    .custom((value) => isValidUrlOrUploadPath(value))
    .withMessage('mediaUrl must be a valid URL or uploaded file path'),
  body('thumbnailUrl')
    .optional()
    .custom((value) => isValidUrlOrUploadPath(value))
    .withMessage('thumbnailUrl must be a valid URL or uploaded file path'),
  body('latitude').optional().isFloat(),
  body('longitude').optional().isFloat(),
];

const chatMessageListValidation = [
  param('chatId').isMongoId().withMessage('Invalid chat id'),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

const messageIdValidation = [
  param('messageId').isMongoId().withMessage('Invalid message id'),
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
  messageIdValidation,
  messageSearchValidation,
  editMessageValidation,
  reactionValidation,
};
