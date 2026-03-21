const { query } = require('express-validator');

const globalSearchValidation = [
  query('q').trim().notEmpty().withMessage('q is required').isLength({ min: 1, max: 100 }),
  query('limit').optional().isInt({ min: 1, max: 20 }).withMessage('limit must be between 1 and 20'),
];

module.exports = {
  globalSearchValidation,
};
