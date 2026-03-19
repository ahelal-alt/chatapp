const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const validateRequest = require('../../middleware/validate.middleware');
const controller = require('./message.controller');
const validation = require('./message.validation');

const router = express.Router();

router.use(authenticate);

router.post('/', validation.sendMessageValidation, validateRequest, controller.sendMessage);
router.get('/chat/:chatId', validation.chatMessageListValidation, validateRequest, controller.listMessages);
router.get('/:messageId', validation.messageIdValidation, validateRequest, controller.getMessage);
router.put('/:messageId', validation.editMessageValidation, validateRequest, controller.editMessage);
router.delete('/:messageId', validation.messageIdValidation, validateRequest, controller.deleteMessage);
router.delete('/:messageId/for-me', validation.messageIdValidation, validateRequest, controller.deleteMessageForMe);
router.post('/:messageId/reply', validation.messageIdValidation, validateRequest, controller.replyToMessage);
router.post('/:messageId/forward', validation.messageIdValidation, validateRequest, controller.forwardMessage);
router.post('/:messageId/reactions', validation.reactionValidation, validateRequest, controller.addReaction);
router.delete('/:messageId/reactions', validation.messageIdValidation, validateRequest, controller.removeReaction);
router.put('/:messageId/seen', validation.messageIdValidation, validateRequest, controller.markSeen);
router.put('/:messageId/delivered', validation.messageIdValidation, validateRequest, controller.markDelivered);

module.exports = router;

