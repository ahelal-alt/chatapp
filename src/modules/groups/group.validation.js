const { body, param } = require('express-validator');

const createGroupValidation = [
  body('name').trim().notEmpty().withMessage('name is required'),
  body('memberIds').optional().isArray(),
  body('memberIds.*').optional().isMongoId().withMessage('memberIds must contain valid user ids'),
];

const groupIdValidation = [
  param('groupId').isMongoId().withMessage('Invalid group id'),
];

const memberActionValidation = [
  ...groupIdValidation,
  param('userId').isMongoId().withMessage('Invalid user id'),
];

const addMembersValidation = [
  ...groupIdValidation,
  body('userIds').isArray({ min: 1 }).withMessage('userIds is required'),
  body('userIds.*').isMongoId().withMessage('userIds must contain valid user ids'),
];

const inviteCodeValidation = [
  param('inviteCode').trim().notEmpty().withMessage('inviteCode is required'),
];

module.exports = {
  createGroupValidation,
  groupIdValidation,
  memberActionValidation,
  addMembersValidation,
  inviteCodeValidation,
};

