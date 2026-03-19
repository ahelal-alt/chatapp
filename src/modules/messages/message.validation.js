const { body, param, query } = require('express-validator');

const sendMessageValidation = [
  body('chatId').isMongoId().withMessage('chatId is required'),
  body('type').optional().isIn(['text', 'image', 'video', 'audio', 'file', 'voice', 'location']),
  body('text').optional().isString(),
  body('mediaUrl').optional().isURL().withMessage('mediaUrl must be a valid URL'),
  body('thumbnailUrl').optional().isURL().withMessage('thumbnailUrl must be a valid URL'),
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
  editMessageValidation,
  reactionValidation,
};

