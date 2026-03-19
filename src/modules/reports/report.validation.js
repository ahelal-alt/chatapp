const { body, param } = require('express-validator');

const createReportValidation = [
  body('reason').trim().notEmpty().withMessage('reason is required'),
];

const userReportValidation = [
  ...createReportValidation,
  param('userId').isMongoId().withMessage('Invalid user id'),
];

const messageReportValidation = [
  ...createReportValidation,
  param('messageId').isMongoId().withMessage('Invalid message id'),
];

module.exports = {
  userReportValidation,
  messageReportValidation,
};

