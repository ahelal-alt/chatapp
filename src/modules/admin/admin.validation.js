const { body, param, query } = require('express-validator');

const userIdValidation = [
  param('userId').isMongoId().withMessage('Invalid user id'),
];

const messageIdValidation = [
  param('messageId').isMongoId().withMessage('Invalid message id'),
];

const reportIdValidation = [
  param('reportId').isMongoId().withMessage('Invalid report id'),
];

const listValidation = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

const analyticsValidation = [
  query('days').optional().isInt({ min: 1, max: 365 }).withMessage('days must be between 1 and 365'),
];

const reviewReportValidation = [
  ...reportIdValidation,
  body('status')
    .isIn(['reviewed', 'resolved', 'dismissed'])
    .withMessage('status must be reviewed, resolved, or dismissed'),
  body('moderationNotes').optional().isString().isLength({ max: 1000 }),
];

module.exports = {
  userIdValidation,
  messageIdValidation,
  reportIdValidation,
  listValidation,
  analyticsValidation,
  reviewReportValidation,
};
