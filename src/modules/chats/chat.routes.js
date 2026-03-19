const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const validateRequest = require('../../middleware/validate.middleware');
const controller = require('./chat.controller');
const validation = require('./chat.validation');

const router = express.Router();

router.use(authenticate);

router.post('/private/:userId', validation.openPrivateChatValidation, validateRequest, controller.openPrivateChat);
router.get('/', validation.listChatValidation, validateRequest, controller.listChats);
router.get('/:chatId', validation.chatIdValidation, validateRequest, controller.getChatDetails);
router.put('/:chatId/archive', validation.chatIdValidation, validateRequest, controller.archiveChat);
router.put('/:chatId/unarchive', validation.chatIdValidation, validateRequest, controller.unarchiveChat);
router.put('/:chatId/mute', validation.muteChatValidation, validateRequest, controller.muteChat);
router.put('/:chatId/unmute', validation.chatIdValidation, validateRequest, controller.unmuteChat);
router.put('/:chatId/pin', validation.chatIdValidation, validateRequest, controller.pinChat);
router.put('/:chatId/unpin', validation.chatIdValidation, validateRequest, controller.unpinChat);
router.delete('/:chatId/clear', validation.chatIdValidation, validateRequest, controller.clearChat);

module.exports = router;

