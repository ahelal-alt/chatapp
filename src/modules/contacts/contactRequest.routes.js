const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const validateRequest = require('../../middleware/validate.middleware');
const controller = require('./contact.controller');
const validation = require('./contact.validation');

const router = express.Router();

router.use(authenticate);

router.post('/', validation.sendRequestValidation, validateRequest, controller.sendRequest);
router.get('/incoming', validation.listValidation, validateRequest, controller.listIncoming);
router.get('/outgoing', validation.listValidation, validateRequest, controller.listOutgoing);
router.put(
  '/:requestId/accept',
  validation.requestActionValidation,
  validateRequest,
  controller.acceptRequest,
);
router.put(
  '/:requestId/reject',
  validation.requestActionValidation,
  validateRequest,
  controller.rejectRequest,
);
router.put(
  '/:requestId/cancel',
  validation.requestActionValidation,
  validateRequest,
  controller.cancelRequest,
);

module.exports = router;

