const express = require('express');
const { authenticate, authenticateOptional } = require('../../middleware/auth.middleware');
const validateRequest = require('../../middleware/validate.middleware');
const controller = require('./invite.controller');
const validation = require('./invite.validation');

const router = express.Router();

router.get(
  '/public/:token',
  authenticateOptional,
  validation.publicInviteTokenValidation,
  validateRequest,
  controller.getPublicInvite,
);
router.post(
  '/public/:token/register',
  validation.publicInviteRegisterValidation,
  validateRequest,
  controller.registerFromPublicInvite,
);
router.post(
  '/public/:token/login',
  validation.publicInviteLoginValidation,
  validateRequest,
  controller.loginFromPublicInvite,
);
router.post(
  '/public/:token/accept',
  authenticateOptional,
  validation.publicInviteTokenValidation,
  validateRequest,
  controller.acceptPublicInvite,
);

router.use(authenticate);

router.get('/', validation.listInvitesValidation, validateRequest, controller.listInvites);
router.post('/', validation.createInviteValidation, validateRequest, controller.createInvite);
router.post('/accept', validation.acceptInviteValidation, validateRequest, controller.acceptInvite);
router.get('/:inviteId', validation.inviteIdValidation, validateRequest, controller.getInviteDetails);
router.post('/:inviteId/resend', validation.inviteIdValidation, validateRequest, controller.resendInvite);
router.delete('/:inviteId', validation.inviteIdValidation, validateRequest, controller.revokeInvite);

module.exports = router;
