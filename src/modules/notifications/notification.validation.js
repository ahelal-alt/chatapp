const { param, query } = require('express-validator');

const notificationIdValidation = [
  param('notificationId').isMongoId().withMessage('Invalid notification id'),
];

const listValidation = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

module.exports = {
  notificationIdValidation,
  listValidation,
};
