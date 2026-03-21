const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const validateRequest = require('../../middleware/validate.middleware');
const controller = require('./contact.controller');
const validation = require('./contact.validation');

const router = express.Router();

router.use(authenticate);

router.get('/', validation.listValidation, validateRequest, controller.listContacts);
router.get('/recent', validation.listValidation, validateRequest, controller.listRecentContacts);
router.delete(
  '/:contactUserId',
  validation.contactUserValidation,
  validateRequest,
  controller.removeContact,
);
router.post(
  '/:contactUserId/favorite',
  validation.contactUserValidation,
  validateRequest,
  controller.favoriteContact,
);
router.delete(
  '/:contactUserId/favorite',
  validation.contactUserValidation,
  validateRequest,
  controller.unfavoriteContact,
);
router.post(
  '/:contactUserId/mute',
  validation.muteContactValidation,
  validateRequest,
  controller.muteContact,
);
router.delete(
  '/:contactUserId/mute',
  validation.contactUserValidation,
  validateRequest,
  controller.unmuteContact,
);

module.exports = router;
