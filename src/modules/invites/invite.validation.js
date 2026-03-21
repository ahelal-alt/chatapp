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

const publicInviteTokenValidation = [
  param('token').isString().trim().isLength({ min: 32, max: 256 }).withMessage('Invalid invite token'),
];

const publicInviteRegisterValidation = [
  ...publicInviteTokenValidation,
  body('fullName')
    .trim()
    .isLength({ min: 2, max: 120 })
    .withMessage('Full name must be between 2 and 120 characters long.'),
  body('username')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[a-zA-Z0-9._-]{3,30}$/)
    .withMessage('Username must be 3 to 30 characters and use letters, numbers, dots, underscores, or dashes.'),
  body('email')
    .optional({ values: 'falsy' })
    .isEmail()
    .withMessage('Enter a valid email address.'),
  body('password').isString().notEmpty().withMessage('Password is required.'),
  body('confirmPassword')
    .isString()
    .custom((value, { req }) => value === req.body.password)
    .withMessage('Passwords do not match.'),
];

const publicInviteLoginValidation = [
  ...publicInviteTokenValidation,
  body('email')
    .optional({ values: 'falsy' })
    .isEmail()
    .withMessage('Enter a valid email address.'),
  body('password').isString().notEmpty().withMessage('Password is required.'),
  body('rememberMe').optional().isBoolean().withMessage('rememberMe must be true or false.'),
];

module.exports = {
  listInvitesValidation,
  createInviteValidation,
  inviteIdValidation,
  acceptInviteValidation,
  publicInviteTokenValidation,
  publicInviteRegisterValidation,
  publicInviteLoginValidation,
};
