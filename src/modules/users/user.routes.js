const express = require('express');
const validateRequest = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/auth.middleware');
const controller = require('./user.controller');
const validation = require('./user.validation');

const router = express.Router();

router.use(authenticate);

router.get('/me', controller.getMe);
router.put('/me', validation.updateMeValidation, validateRequest, controller.updateMe);
router.put(
  '/me/profile-image',
  validation.profileImageValidation,
  validateRequest,
  controller.updateMyProfileImage,
);
router.get('/search', validation.searchUsersValidation, validateRequest, controller.searchUsers);
router.get('/:userId/profile', validation.userIdValidation, validateRequest, controller.getProfileById);
router.get(
  '/:userId/mutual-contacts',
  validation.userIdValidation,
  validateRequest,
  controller.getMutualContacts,
);

module.exports = router;

