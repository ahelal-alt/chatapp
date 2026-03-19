const { body, param, query } = require('express-validator');

const updateMeValidation = [
  body('fullName').optional().isString().trim().notEmpty(),
  body('bio').optional().isString().isLength({ max: 250 }),
  body('location').optional().isString().isLength({ max: 100 }),
  body('statusMessage').optional().isString().isLength({ max: 120 }),
  body('profileImage').optional().isURL().withMessage('profileImage must be a valid URL'),
];

const profileImageValidation = [
  body('profileImage').isURL().withMessage('profileImage must be a valid URL'),
];

const userIdValidation = [
  param('userId').isMongoId().withMessage('Invalid user id'),
];

const searchUsersValidation = [
  query('query').trim().notEmpty().withMessage('query is required'),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

module.exports = {
  updateMeValidation,
  profileImageValidation,
  userIdValidation,
  searchUsersValidation,
};

