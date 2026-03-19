const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const validateRequest = require('../../middleware/validate.middleware');
const { updatePrivacyValidation } = require('./privacy.validation');
const controller = require('./privacy.controller');

const router = express.Router();

router.use(authenticate);

router.get('/', controller.getPrivacy);
router.put('/', updatePrivacyValidation, validateRequest, controller.updatePrivacy);

module.exports = router;

