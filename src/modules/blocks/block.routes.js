const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const validateRequest = require('../../middleware/validate.middleware');
const controller = require('./block.controller');
const validation = require('./block.validation');

const router = express.Router();

router.use(authenticate);

router.post('/:userId', validation.userIdValidation, validateRequest, controller.blockUser);
router.delete('/:userId', validation.userIdValidation, validateRequest, controller.unblockUser);
router.get('/', validation.listValidation, validateRequest, controller.listBlockedUsers);

module.exports = router;

