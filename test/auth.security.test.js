const test = require('node:test');
const assert = require('node:assert/strict');

const env = require('../src/config/env');
const User = require('../src/modules/users/user.model');
const PrivacySettings = require('../src/modules/privacy/privacy.model');
const AuthSession = require('../src/modules/auth/authSession.model');
const authService = require('../src/modules/auth/auth.service');
const mailer = require('../src/utils/mailer');
const { evaluatePassword, hashPassword, comparePassword } = require('../src/utils/password');
const { authenticate } = require('../src/middleware/auth.middleware');
const { signAccessToken } = require('../src/utils/token');

function createMockUser(overrides = {}) {
  return {
    _id: overrides._id || '507f1f77bcf86cd799439011',
    fullName: overrides.fullName || 'Ahmed Helal',
    username: overrides.username || 'ahelal',
    email: overrides.email || 'ahmed@example.com',
    emailNormalized: overrides.emailNormalized || 'ahmed@example.com',
    role: overrides.role || 'user',
    isActive: overrides.isActive ?? true,
    isVerified: overrides.isVerified ?? false,
    isEmailVerified: overrides.isEmailVerified ?? false,
    accountStatus: overrides.accountStatus || 'pending_verification',
    sessionVersion: overrides.sessionVersion ?? 0,
    failedLoginAttempts: overrides.failedLoginAttempts ?? 0,
    lockUntil: overrides.lockUntil ?? null,
    passwordHash: overrides.passwordHash || '$2a$10$abcdefghijklmnopqrstuv',
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
      return this;
    },
    toJSON() {
      return {
        _id: this._id,
        fullName: this.fullName,
        username: this.username,
        email: this.email,
        role: this.role,
        isActive: this.isActive,
        isVerified: this.isVerified,
        isEmailVerified: this.isEmailVerified,
        accountStatus: this.accountStatus,
      };
    },
    ...overrides,
  };
}

let originals;

test.beforeEach(() => {
  originals = {
    userFindOne: User.findOne,
    userCreate: User.create,
    userExists: User.exists,
    userFindById: User.findById,
    userUpdateOne: User.updateOne,
    privacyCreate: PrivacySettings.create,
    authSessionCreate: AuthSession.create,
    authSessionUpdateMany: AuthSession.updateMany,
    authSessionFindOneAndUpdate: AuthSession.findOneAndUpdate,
    sendVerificationEmail: mailer.sendVerificationEmail,
    sendPasswordResetEmail: mailer.sendPasswordResetEmail,
  };
});

test.afterEach(() => {
  User.findOne = originals.userFindOne;
  User.create = originals.userCreate;
  User.exists = originals.userExists;
  User.findById = originals.userFindById;
  User.updateOne = originals.userUpdateOne;
  PrivacySettings.create = originals.privacyCreate;
  AuthSession.create = originals.authSessionCreate;
  AuthSession.updateMany = originals.authSessionUpdateMany;
  AuthSession.findOneAndUpdate = originals.authSessionFindOneAndUpdate;
  mailer.sendVerificationEmail = originals.sendVerificationEmail;
  mailer.sendPasswordResetEmail = originals.sendPasswordResetEmail;
});

test('password helper hashes and verifies secrets', async () => {
  const password = 'correct horse battery staple 42!';
  const hashed = await hashPassword(password);
  assert.notEqual(hashed, password);
  assert.equal(await comparePassword(password, hashed), true);
  assert.equal(await comparePassword('wrong password', hashed), false);
});

test('password policy rejects common and user-derived passwords', () => {
  const weak = evaluatePassword('password', { email: 'ahmed@example.com', fullName: 'Ahmed Helal' });
  assert.equal(weak.isValid, false);

  const derived = evaluatePassword('AhmedSecure123!', { email: 'ahmed@example.com', fullName: 'Ahmed Helal' });
  assert.equal(derived.isValid, false);
});

test('register creates a verification-pending account with normalized identifiers', async () => {
  User.findOne = () => ({
    lean: async () => null,
  });
  User.exists = async () => false;
  const createdUser = createMockUser({
    email: 'new.user@example.com',
    emailNormalized: 'new.user@example.com',
    username: 'newuser',
    accountStatus: 'pending_verification',
    isActive: false,
  });
  User.create = async (payload) => {
    createdUser.email = payload.email;
    createdUser.emailNormalized = payload.emailNormalized;
    createdUser.username = payload.username;
    createdUser.passwordHash = payload.passwordHash;
    createdUser.accountStatus = payload.accountStatus;
    createdUser.isActive = payload.isActive;
    return createdUser;
  };
  PrivacySettings.create = async () => ({});
  AuthSession.create = async () => ({ _id: 'session-1' });
  let sentVerificationPayload = null;
  mailer.sendVerificationEmail = async (payload) => {
    sentVerificationPayload = payload;
    return { status: 'sent', configured: true };
  };

  const result = await authService.register({
    fullName: 'New User',
    email: 'New.User@Example.com',
    username: 'NewUser',
    password: 'Correct horse battery staple 42!',
    confirmPassword: 'Correct horse battery staple 42!',
  }, { ipAddress: '127.0.0.1', userAgent: 'test' });

  assert.equal(result.requiresEmailVerification, true);
  assert.equal(result.user.email, 'new.user@example.com');
  assert.equal(result.user.username, 'newuser');
  assert.equal(result.user.accountStatus, 'pending_verification');
  assert.notEqual(createdUser.passwordHash, 'Correct horse battery staple 42!');
  assert.equal(result.emailDelivery.status, 'sent');
  assert.equal(sentVerificationPayload.to, 'new.user@example.com');
  assert.ok(sentVerificationPayload.token);
});

test('login keeps invalid-credential messaging generic', async () => {
  User.findOne = () => ({
    select: async () => null,
  });

  await assert.rejects(
    authService.login({ email: 'missing@example.com', password: 'whatever' }, { ipAddress: '127.0.0.1', userAgent: 'test' }),
    (error) => error.statusCode === 401 && error.message === 'Invalid email or password',
  );
});

test('verify email activates the account and issues tokens', async () => {
  const verificationUser = createMockUser({
    isVerified: false,
    isEmailVerified: false,
    isActive: false,
    accountStatus: 'pending_verification',
    sessionVersion: 0,
  });

  User.findOne = () => ({
    select: async () => verificationUser,
  });
  AuthSession.create = async () => ({ _id: 'session-verify' });

  const result = await authService.verifyEmail({ token: 'opaque-token' }, { ipAddress: '127.0.0.1', userAgent: 'test' });

  assert.equal(result.user.isEmailVerified, true);
  assert.equal(result.user.accountStatus, 'active');
  assert.ok(result.tokens.accessToken);
  assert.ok(result.tokens.refreshToken);
});

test('forgot password sends reset email metadata for known accounts', async () => {
  const user = createMockUser({
    email: 'reset@example.com',
    emailNormalized: 'reset@example.com',
    isVerified: true,
    isEmailVerified: true,
    accountStatus: 'active',
  });

  User.findOne = () => ({
    select: async () => user,
  });

  let sentResetPayload = null;
  mailer.sendPasswordResetEmail = async (payload) => {
    sentResetPayload = payload;
    return { status: 'sent', configured: true };
  };

  const result = await authService.forgotPassword({
    email: 'reset@example.com',
  }, { ipAddress: '127.0.0.1', userAgent: 'test' });

  assert.equal(result.message, 'If the email exists, reset instructions will be sent.');
  assert.equal(result.emailDelivery.status, 'sent');
  assert.equal(sentResetPayload.to, 'reset@example.com');
  assert.ok(sentResetPayload.token);
});

test('auth middleware rejects tokens after session version changes', async () => {
  const token = signAccessToken({
    sub: '507f1f77bcf86cd799439011',
    role: 'user',
    type: 'access',
    sv: 1,
  });

  User.findById = async () => createMockUser({
    _id: '507f1f77bcf86cd799439011',
    sessionVersion: 2,
    isActive: true,
    accountStatus: 'active',
    isVerified: true,
    isEmailVerified: true,
  });

  const req = {
    headers: {
      authorization: `Bearer ${token}`,
    },
  };

  await new Promise((resolve, reject) => {
    authenticate(req, {}, (error) => {
      try {
        assert.ok(error);
        assert.equal(error.statusCode, 401);
        resolve();
      } catch (assertionError) {
        reject(assertionError);
      }
    });
  });
});
