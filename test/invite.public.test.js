const test = require('node:test');
const assert = require('node:assert/strict');

const Invite = require('../src/modules/invites/invite.model');
const User = require('../src/modules/users/user.model');
const authService = require('../src/modules/auth/auth.service');
const inviteService = require('../src/modules/invites/invite.service');

function createInviteDoc(overrides = {}) {
  return {
    _id: overrides._id || '507f1f77bcf86cd799439001',
    email: overrides.email || 'invitee@example.com',
    emailNormalized: overrides.emailNormalized || 'invitee@example.com',
    invitedByUserId: overrides.invitedByUserId || {
      _id: '507f1f77bcf86cd799439010',
      fullName: 'Workspace Owner',
      username: 'owner',
      profileImage: '',
    },
    status: overrides.status || 'pending',
    expiresAt: overrides.expiresAt || new Date(Date.now() + 60 * 60 * 1000),
    acceptedByUserId: overrides.acceptedByUserId || null,
    acceptedAt: overrides.acceptedAt || null,
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
      return this;
    },
    ...overrides,
  };
}

let originals;

test.beforeEach(() => {
  originals = {
    inviteFindOne: Invite.findOne,
    inviteCreate: Invite.create,
    userFindOne: User.findOne,
    userFindById: User.findById,
    authRegister: authService.register,
    authLogin: authService.login,
  };
});

test.afterEach(() => {
  Invite.findOne = originals.inviteFindOne;
  Invite.create = originals.inviteCreate;
  User.findOne = originals.userFindOne;
  User.findById = originals.userFindById;
  authService.register = originals.authRegister;
  authService.login = originals.authLogin;
});

test('public invite landing returns invalid state for unknown token', async () => {
  Invite.findOne = async () => null;

  const result = await inviteService.getPublicInvite('missing-token');

  assert.equal(result.status, 'invalid');
  assert.equal(result.nextAction, 'invalid_invite');
  assert.equal(result.accountExists, false);
});

test('invite creation allows inviting an email that already belongs to an account', async () => {
  User.findOne = () => ({
    lean: async () => ({ _id: '507f1f77bcf86cd799439055', email: 'invitee@example.com' }),
  });

  Invite.findOne = () => ({
    lean: async () => null,
  });

  Invite.create = async (payload) => ({
    _id: '507f1f77bcf86cd799439066',
    ...payload,
  });

  const result = await inviteService.createInvite('507f1f77bcf86cd799439010', {
    email: 'invitee@example.com',
  });

  assert.equal(result.invite.emailNormalized, 'invitee@example.com');
  assert.match(result.inviteUrl, /\/invites\//);
});

test('public invite landing returns sign-in recommendation when account already exists', async () => {
  Invite.findOne = async () => createInviteDoc();
  User.findOne = () => ({
    select: async () => ({
      _id: '507f1f77bcf86cd799439099',
      email: 'invitee@example.com',
      emailNormalized: 'invitee@example.com',
    }),
  });

  const result = await inviteService.getPublicInvite('valid-token');

  assert.equal(result.status, 'pending');
  assert.equal(result.accountExists, true);
  assert.equal(result.nextAction, 'sign_in');
  assert.equal(result.canLogin, true);
});

test('public invite landing returns expired state for stale invites', async () => {
  const invite = createInviteDoc({
    expiresAt: new Date(Date.now() - 60 * 1000),
  });
  Invite.findOne = async () => invite;
  User.findOne = () => ({
    select: async () => null,
  });

  const result = await inviteService.getPublicInvite('expired-token');

  assert.equal(result.status, 'expired');
  assert.equal(result.nextAction, 'invite_expired');
});

test('public invite registration auto-accepts the invite and returns auth payload', async () => {
  const invite = createInviteDoc();
  Invite.findOne = async () => invite;
  User.findOne = () => ({
    select: async () => null,
  });
  User.findById = async () => ({
    _id: '507f1f77bcf86cd799439012',
    email: 'invitee@example.com',
    emailNormalized: 'invitee@example.com',
  });

  let registerOptions;
  authService.register = async (_payload, _context, options) => {
    registerOptions = options;
    return {
      user: {
        _id: '507f1f77bcf86cd799439012',
        email: 'invitee@example.com',
        emailNormalized: 'invitee@example.com',
      },
      tokens: {
        accessToken: 'access',
        refreshToken: 'refresh',
      },
    };
  };

  const result = await inviteService.registerFromPublicInvite('valid-token', {
    fullName: 'Invited User',
    username: 'invited.user',
    password: 'Correct horse battery staple 42!',
    confirmPassword: 'Correct horse battery staple 42!',
  }, { ipAddress: '127.0.0.1', userAgent: 'test' });

  assert.equal(registerOptions.skipEmailVerification, true);
  assert.equal(result.invite.status, 'accepted');
  assert.equal(result.invite.nextAction, 'open_app');
  assert.ok(result.auth.tokens.accessToken);
  assert.equal(invite.status, 'accepted');
});

test('public invite login signs in with the invited email and accepts the invite', async () => {
  const invite = createInviteDoc();
  Invite.findOne = async () => invite;
  User.findById = async () => ({
    _id: '507f1f77bcf86cd799439013',
    email: 'invitee@example.com',
    emailNormalized: 'invitee@example.com',
  });

  let loginOptions;
  authService.login = async (_payload, _context, options) => {
    loginOptions = options;
    return {
      user: {
        _id: '507f1f77bcf86cd799439013',
        email: 'invitee@example.com',
        emailNormalized: 'invitee@example.com',
      },
      tokens: {
        accessToken: 'access',
        refreshToken: 'refresh',
      },
    };
  };

  const result = await inviteService.loginFromPublicInvite('valid-token', {
    password: 'Correct horse battery staple 42!',
    rememberMe: true,
  }, { ipAddress: '127.0.0.1', userAgent: 'test' });

  assert.equal(loginOptions.skipEmailVerification, true);
  assert.equal(result.invite.status, 'accepted');
  assert.equal(result.auth.tokens.refreshToken, 'refresh');
  assert.equal(invite.status, 'accepted');
});

test('public invite accept without auth returns a UI-friendly auth-required payload', async () => {
  Invite.findOne = async () => createInviteDoc();
  User.findOne = () => ({
    select: async () => ({
      _id: '507f1f77bcf86cd799439099',
      email: 'invitee@example.com',
      emailNormalized: 'invitee@example.com',
    }),
  });

  const result = await inviteService.acceptPublicInvite('valid-token', null, {});

  assert.equal(result.accepted, false);
  assert.equal(result.invite.status, 'pending');
  assert.equal(result.invite.authRequired, true);
  assert.equal(result.invite.nextAction, 'sign_in');
});
