const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const validateRequest = require('../../middleware/validate.middleware');
const controller = require('./notification.controller');
const validation = require('./notification.validation');

const router = express.Router();

router.use(authenticate);

router.get('/', validation.listValidation, validateRequest, controller.listNotifications);
router.get('/:notificationId', validation.notificationIdValidation, validateRequest, controller.getNotificationDetails);
router.put(
  '/:notificationId/read',
  validation.notificationIdValidation,
  validateRequest,
  controller.markRead,
);
router.put('/read-all', controller.markAllRead);

module.exports = router;
