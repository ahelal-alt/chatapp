const { body } = require('express-validator');

const registerValidation = [
  body('fullName').trim().notEmpty().withMessage('fullName is required'),
  body('username')
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage('username must be between 3 and 30 characters'),
  body('email').isEmail().withMessage('A valid email is required'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('password must be at least 8 characters long'),
];

const loginValidation = [
  body('email').isEmail().withMessage('A valid email is required'),
  body('password').notEmpty().withMessage('password is required'),
];

const changePasswordValidation = [
  body('currentPassword').notEmpty().withMessage('currentPassword is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('newPassword must be at least 8 characters long'),
];

const forgotPasswordValidation = [
  body('email').isEmail().withMessage('A valid email is required'),
];

const resetPasswordValidation = [
  body('token').notEmpty().withMessage('token is required'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('password must be at least 8 characters long'),
];

const verifyEmailValidation = [
  body('token').notEmpty().withMessage('token is required'),
];

const resendVerificationValidation = [
  body('email').optional().isEmail().withMessage('email must be valid'),
];

const refreshTokenValidation = [
  body('refreshToken').notEmpty().withMessage('refreshToken is required'),
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
};

