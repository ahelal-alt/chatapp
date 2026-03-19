const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const validateRequest = require('../../middleware/validate.middleware');
const controller = require('./group.controller');
const validation = require('./group.validation');

const router = express.Router();

router.use(authenticate);

router.post('/', validation.createGroupValidation, validateRequest, controller.createGroup);
router.get('/:groupId', validation.groupIdValidation, validateRequest, controller.getGroup);
router.put('/:groupId', validation.groupIdValidation, validateRequest, controller.updateGroup);
router.delete('/:groupId', validation.groupIdValidation, validateRequest, controller.deleteGroup);
router.post('/:groupId/members', validation.addMembersValidation, validateRequest, controller.addMembers);
router.delete('/:groupId/members/:userId', validation.memberActionValidation, validateRequest, controller.removeMember);
router.put('/:groupId/members/:userId/promote', validation.memberActionValidation, validateRequest, controller.promoteMember);
router.put('/:groupId/members/:userId/demote', validation.memberActionValidation, validateRequest, controller.demoteMember);
router.post('/:groupId/leave', validation.groupIdValidation, validateRequest, controller.leaveGroup);
router.post('/:groupId/invite-code', validation.groupIdValidation, validateRequest, controller.generateInviteCode);
router.post('/join/:inviteCode', validation.inviteCodeValidation, validateRequest, controller.joinByInviteCode);

module.exports = router;

