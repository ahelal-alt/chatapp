const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const validateRequest = require('../../middleware/validate.middleware');
const controller = require('./call.controller');
const validation = require('./call.validation');

const router = express.Router();

router.use(authenticate);

router.post('/', validation.createCallValidation, validateRequest, controller.createCall);
router.get('/', validation.listCallsValidation, validateRequest, controller.listCalls);
router.get('/:callId', validation.callIdValidation, validateRequest, controller.getCall);
router.post('/:callId/join', validation.callIdValidation, validateRequest, controller.joinCall);
router.post('/:callId/leave', validation.callIdValidation, validateRequest, controller.leaveCall);
router.post('/:callId/end', validation.callIdValidation, validateRequest, controller.endCall);

module.exports = router;
