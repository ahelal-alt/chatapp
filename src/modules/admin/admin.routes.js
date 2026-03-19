const express = require('express');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const validateRequest = require('../../middleware/validate.middleware');
const controller = require('./admin.controller');
const validation = require('./admin.validation');

const router = express.Router();

router.use(authenticate, authorize('admin'));

router.get('/dashboard', controller.getDashboardSummary);
router.get('/users', validation.listValidation, validateRequest, controller.listUsers);
router.get('/reports', validation.listValidation, validateRequest, controller.listReports);
router.put('/users/:userId/suspend', validation.userIdValidation, validateRequest, controller.suspendUser);
router.put('/users/:userId/activate', validation.userIdValidation, validateRequest, controller.activateUser);
router.delete('/messages/:messageId', validation.messageIdValidation, validateRequest, controller.deleteMessage);

module.exports = router;
