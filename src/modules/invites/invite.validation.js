const { body, param, query } = require('express-validator');

const listInvitesValidation = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['pending', 'accepted', 'revoked', 'expired']),
];

const createInviteValidation = [
  body('email').isEmail().withMessage('A valid email is required'),
];

const inviteIdValidation = [
  param('inviteId').isMongoId().withMessage('Invalid invite id'),
];

const acceptInviteValidation = [
  body('token').isString().notEmpty().withMessage('Invite token is required'),
];

module.exports = {
  listInvitesValidation,
  createInviteValidation,
  inviteIdValidation,
  acceptInviteValidation,
};
