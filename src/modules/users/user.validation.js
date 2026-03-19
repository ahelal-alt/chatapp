const { body, param, query } = require('express-validator');
const { isValidUrlOrUploadPath } = require('../../utils/validation');

const updateMeValidation = [
  body('fullName').optional().isString().trim().notEmpty(),
  body('bio').optional().isString().isLength({ max: 250 }),
  body('location').optional().isString().isLength({ max: 100 }),
  body('statusMessage').optional().isString().isLength({ max: 120 }),
  body('profileImage')
    .optional()
    .custom((value) => isValidUrlOrUploadPath(value))
    .withMessage('profileImage must be a valid URL or uploaded file path'),
];

const profileImageValidation = [
  body('profileImage')
    .custom((value) => isValidUrlOrUploadPath(value))
    .withMessage('profileImage must be a valid URL or uploaded file path'),
];

const userIdValidation = [
  param('userId').isMongoId().withMessage('Invalid user id'),
];

const searchUsersValidation = [
  query('query').trim().notEmpty().withMessage('query is required').isLength({ max: 100 }),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

const encryptionKeyValidation = [
  body('publicKey').isString().isLength({ min: 40, max: 20000 }).withMessage('publicKey is required'),
  body('keyVersion').optional().isInt({ min: 1, max: 100 }),
];

module.exports = {
  updateMeValidation,
  profileImageValidation,
  userIdValidation,
  searchUsersValidation,
  encryptionKeyValidation,
};
