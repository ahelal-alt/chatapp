const { param, query } = require('express-validator');

const userIdValidation = [
  param('userId').isMongoId().withMessage('Invalid user id'),
];

const listValidation = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

module.exports = {
  userIdValidation,
  listValidation,
};

