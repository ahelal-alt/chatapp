const express = require('express');
const validateRequest = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/auth.middleware');
const {
  loginRateLimit,
  registrationRateLimit,
  passwordResetRateLimit,
  verificationRateLimit,
} = require('../../middleware/rateLimit.middleware');
const controller = require('./auth.controller');
const validation = require('./auth.validation');

const router = express.Router();

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a user
 *     tags: [Auth]
 *     security: []
 *     responses:
 *       201:
 *         description: User registered
 */
router.post('/register', registrationRateLimit, validation.registerValidation, validateRequest, controller.register);
router.post('/login', loginRateLimit, validation.loginValidation, validateRequest, controller.login);
router.post('/logout', controller.logout);
router.post('/logout-all', authenticate, controller.logoutAll);
router.get('/sessions', authenticate, controller.listSessions);
router.delete('/sessions/:sessionId', authenticate, validation.revokeSessionValidation, validateRequest, controller.revokeSession);
router.post('/deactivate-account', authenticate, validation.deactivateAccountValidation, validateRequest, controller.deactivateAccount);
router.post('/delete-account', authenticate, validation.deleteAccountValidation, validateRequest, controller.deleteAccount);
router.post('/refresh', validation.refreshTokenValidation, validateRequest, controller.refreshToken);
router.post('/refresh-token', validation.refreshTokenValidation, validateRequest, controller.refreshToken);
router.get('/me', authenticate, controller.me);
router.put(
  '/change-password',
  authenticate,
  validation.changePasswordValidation,
  validateRequest,
  controller.changePassword,
);
router.post(
  '/change-password',
  authenticate,
  validation.changePasswordValidation,
  validateRequest,
  controller.changePassword,
);
router.post(
  '/forgot-password',
  passwordResetRateLimit,
  validation.forgotPasswordValidation,
  validateRequest,
  controller.forgotPassword,
);
router.post(
  '/reset-password',
  passwordResetRateLimit,
  validation.resetPasswordValidation,
  validateRequest,
  controller.resetPassword,
);
router.post(
  '/verify-email',
  verificationRateLimit,
  validation.verifyEmailValidation,
  validateRequest,
  controller.verifyEmail,
);
router.post(
  '/resend-verification',
  verificationRateLimit,
  validation.resendVerificationValidation,
  validateRequest,
  controller.resendVerification,
);

module.exports = router;
