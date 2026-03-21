const { body, param, query } = require('express-validator');

const createCallValidation = [
  body('chatId').isMongoId().withMessage('chatId is required'),
  body('type').optional().isIn(['voice', 'video']).withMessage('type must be voice or video'),
];

const callIdValidation = [
  param('callId').isMongoId().withMessage('Invalid call id'),
];

const rejectCallValidation = [
  ...callIdValidation,
];

const acceptCallValidation = [
  ...callIdValidation,
];

const syncCallValidation = [
  ...callIdValidation,
];

const participantStateValidation = [
  ...callIdValidation,
  body('state')
    .isIn(['ringing', 'connecting', 'connected'])
    .withMessage('state must be ringing, connecting, or connected'),
];

const listCallsValidation = [
  query('status').optional().isIn(['pending', 'active', 'ringing', 'connecting', 'connected', 'declined', 'ended', 'missed']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

module.exports = {
  createCallValidation,
  callIdValidation,
  acceptCallValidation,
  rejectCallValidation,
  syncCallValidation,
  participantStateValidation,
  listCallsValidation,
};
