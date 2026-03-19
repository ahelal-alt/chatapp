const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const validateRequest = require('../../middleware/validate.middleware');
const controller = require('./report.controller');
const validation = require('./report.validation');

const router = express.Router();

router.use(authenticate);

router.post('/user/:userId', validation.userReportValidation, validateRequest, controller.reportUser);
router.post('/message/:messageId', validation.messageReportValidation, validateRequest, controller.reportMessage);

module.exports = router;

