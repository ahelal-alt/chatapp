const { body, param, query } = require('express-validator');
const { isValidUrlOrUploadPath } = require('../../utils/validation');

const createGroupValidation = [
  body('name').trim().notEmpty().withMessage('name is required'),
  body('description').optional().isString().trim(),
  body('image')
    .optional()
    .custom((value) => isValidUrlOrUploadPath(value))
    .withMessage('image must be a valid URL or uploaded file path'),
  body('onlyAdminsCanMessage').optional().isBoolean(),
  body('onlyAdminsCanEditInfo').optional().isBoolean(),
  body('onlyAdminsCanAddMembers').optional().isBoolean(),
  body('memberIds').optional().isArray(),
  body('memberIds.*').optional().isMongoId().withMessage('memberIds must contain valid user ids'),
];

const groupIdValidation = [
  param('groupId').isMongoId().withMessage('Invalid group id'),
];

const updateGroupValidation = [
  ...groupIdValidation,
  body('name').optional().trim().notEmpty().withMessage('name cannot be empty'),
  body('description').optional().isString().trim(),
  body('image')
    .optional()
    .custom((value) => isValidUrlOrUploadPath(value))
    .withMessage('image must be a valid URL or uploaded file path'),
  body('onlyAdminsCanMessage').optional().isBoolean(),
  body('onlyAdminsCanEditInfo').optional().isBoolean(),
  body('onlyAdminsCanAddMembers').optional().isBoolean(),
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

const listGroupsValidation = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

const submitJoinRequestValidation = [
  ...groupIdValidation,
  body('message').optional().isString().trim().isLength({ max: 300 }),
];

const listJoinRequestsValidation = [
  ...groupIdValidation,
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['pending', 'approved', 'rejected', 'cancelled']),
];

const reviewJoinRequestValidation = [
  ...groupIdValidation,
  param('requestId').isMongoId().withMessage('Invalid request id'),
];

module.exports = {
  listGroupsValidation,
  createGroupValidation,
  groupIdValidation,
  updateGroupValidation,
  memberActionValidation,
  transferOwnershipValidation: memberActionValidation,
  addMembersValidation,
  inviteCodeValidation,
  submitJoinRequestValidation,
  listJoinRequestsValidation,
  reviewJoinRequestValidation,
};
