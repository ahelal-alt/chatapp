const express = require('express');
const validateRequest = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/auth.middleware');
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
router.post('/register', validation.registerValidation, validateRequest, controller.register);
router.post('/login', validation.loginValidation, validateRequest, controller.login);
router.post('/logout', controller.logout);
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
  '/forgot-password',
  validation.forgotPasswordValidation,
  validateRequest,
  controller.forgotPassword,
);
router.post(
  '/reset-password',
  validation.resetPasswordValidation,
  validateRequest,
  controller.resetPassword,
);
router.post(
  '/verify-email',
  validation.verifyEmailValidation,
  validateRequest,
  controller.verifyEmail,
);
router.post(
  '/resend-verification',
  authenticate,
  validation.resendVerificationValidation,
  validateRequest,
  controller.resendVerification,
);

module.exports = router;
