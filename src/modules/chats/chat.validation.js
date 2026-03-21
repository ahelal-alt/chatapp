const { body, param, query } = require('express-validator');

const openPrivateChatValidation = [
  param('userId').isMongoId().withMessage('Invalid user id'),
];

const chatIdValidation = [
  param('chatId').isMongoId().withMessage('Invalid chat id'),
];

const listChatValidation = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('archived').optional().isBoolean().withMessage('archived must be true or false'),
  query('muted').optional().isBoolean().withMessage('muted must be true or false'),
  query('pinned').optional().isBoolean().withMessage('pinned must be true or false'),
  query('type').optional().isIn(['private', 'group']).withMessage('type must be private or group'),
  query('q').optional().trim().isLength({ min: 1, max: 80 }),
];

const muteChatValidation = [
  ...chatIdValidation,
  body('mutedUntil').optional().isISO8601().withMessage('mutedUntil must be a valid date'),
];

module.exports = {
  openPrivateChatValidation,
  chatIdValidation,
  listChatValidation,
  muteChatValidation,
};
