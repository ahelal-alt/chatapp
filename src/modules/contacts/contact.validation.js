const { body, param, query } = require('express-validator');

const sendRequestValidation = [
  body('receiverId').isMongoId().withMessage('receiverId is required'),
];

const requestActionValidation = [
  param('requestId').isMongoId().withMessage('Invalid request id'),
];

const contactUserValidation = [
  param('contactUserId').isMongoId().withMessage('Invalid contact user id'),
];

const listValidation = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

module.exports = {
  sendRequestValidation,
  requestActionValidation,
  contactUserValidation,
  listValidation,
};

