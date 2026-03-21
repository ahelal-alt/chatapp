const { body, param } = require('express-validator');
const env = require('../../config/env');
const { evaluatePassword } = require('../../utils/password');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function passwordPolicyValidator(value, { req, path }) {
  const result = evaluatePassword(value, {
    email: req.body.email,
    username: req.body.username,
    fullName: req.body.fullName,
  });

  if (!result.isValid) {
    throw new Error(result.reasons[0]);
  }

  if (path === 'newPassword' && value === String(req.body.currentPassword || '')) {
    throw new Error('New password must be different from the current password.');
  }

  return true;
}

const registerValidation = [
  body('fullName')
    .trim()
    .isLength({ min: 2, max: 120 })
    .withMessage('Full name must be between 2 and 120 characters long.'),
  body('email')
    .customSanitizer(normalizeEmail)
    .isEmail()
    .withMessage('Enter a valid email address.'),
  body('username')
    .optional({ values: 'falsy' })
    .customSanitizer(normalizeUsername)
    .matches(/^[a-z0-9._-]{3,30}$/)
    .withMessage('Username must be 3 to 30 characters and use letters, numbers, dots, underscores, or dashes.'),
  body('password')
    .isString()
    .withMessage('Password is required.')
    .custom(passwordPolicyValidator),
  body('confirmPassword')
    .isString()
    .withMessage('Confirm your password.')
    .custom((value, { req }) => value === req.body.password)
    .withMessage('Passwords do not match.'),
];

const loginValidation = [
  body('email')
    .customSanitizer(normalizeEmail)
    .isEmail()
    .withMessage('Enter a valid email address.'),
  body('password').isString().notEmpty().withMessage('Password is required.'),
  body('rememberMe').optional().isBoolean().withMessage('rememberMe must be true or false.'),
];

const changePasswordValidation = [
  body('currentPassword').isString().notEmpty().withMessage('Current password is required.'),
  body('newPassword').isString().custom(passwordPolicyValidator),
  body('confirmNewPassword')
    .isString()
    .custom((value, { req }) => value === req.body.newPassword)
    .withMessage('New passwords do not match.'),
];

const forgotPasswordValidation = [
  body('email')
    .customSanitizer(normalizeEmail)
    .isEmail()
    .withMessage('Enter a valid email address.'),
];

const resetPasswordValidation = [
  body('token').isString().notEmpty().withMessage('Reset token is required.'),
  body('password').isString().custom(passwordPolicyValidator),
  body('confirmPassword')
    .isString()
    .custom((value, { req }) => value === req.body.password)
    .withMessage('Passwords do not match.'),
];

const verifyEmailValidation = [
  body('token').isString().notEmpty().withMessage('Verification token is required.'),
];

const resendVerificationValidation = [
  body('email')
    .optional({ values: 'falsy' })
    .customSanitizer(normalizeEmail)
    .isEmail()
    .withMessage('Enter a valid email address.'),
];

const refreshTokenValidation = [
  body('refreshToken').optional().isString().notEmpty().withMessage('refreshToken must be a non-empty string.'),
];

const revokeSessionValidation = [
  param('sessionId').isMongoId().withMessage('sessionId must be a valid session id.'),
];

const deactivateAccountValidation = [
  body('currentPassword').isString().notEmpty().withMessage('Current password is required.'),
];

const deleteAccountValidation = [
  body('currentPassword').isString().notEmpty().withMessage('Current password is required.'),
];

module.exports = {
  registerValidation,
  loginValidation,
  changePasswordValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
  verifyEmailValidation,
  resendVerificationValidation,
  refreshTokenValidation,
  revokeSessionValidation,
  deactivateAccountValidation,
  deleteAccountValidation,
  passwordHints: {
    minLength: env.auth.passwordMinLength,
  },
};
