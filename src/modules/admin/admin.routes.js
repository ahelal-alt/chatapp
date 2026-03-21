const express = require('express');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const validateRequest = require('../../middleware/validate.middleware');
const controller = require('./admin.controller');
const validation = require('./admin.validation');

const router = express.Router();

router.use(authenticate, authorize('admin'));

router.get('/dashboard', controller.getDashboardSummary);
router.get('/analytics', validation.analyticsValidation, validateRequest, controller.getAnalytics);
router.get('/users', validation.listValidation, validateRequest, controller.listUsers);
router.get('/users/:userId', validation.userIdValidation, validateRequest, controller.getUserDetails);
router.get('/reports', validation.listValidation, validateRequest, controller.listReports);
router.get('/reports/:reportId', validation.reportIdValidation, validateRequest, controller.getReportDetails);
router.put('/reports/:reportId', validation.reviewReportValidation, validateRequest, controller.reviewReport);
router.put('/users/:userId/suspend', validation.userIdValidation, validateRequest, controller.suspendUser);
router.put('/users/:userId/activate', validation.userIdValidation, validateRequest, controller.activateUser);
router.delete('/messages/:messageId', validation.messageIdValidation, validateRequest, controller.deleteMessage);

module.exports = router;
