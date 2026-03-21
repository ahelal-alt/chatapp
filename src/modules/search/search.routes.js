const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const validateRequest = require('../../middleware/validate.middleware');
const controller = require('./search.controller');
const validation = require('./search.validation');

const router = express.Router();

router.use(authenticate);

router.get('/', validation.globalSearchValidation, validateRequest, controller.searchWorkspace);

module.exports = router;
