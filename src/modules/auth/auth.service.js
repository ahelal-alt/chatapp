const User = require('../users/user.model');
const PrivacySettings = require('../privacy/privacy.model');
const AuthSession = require('./authSession.model');
const ApiError = require('../../utils/ApiError');
const auditLog = require('../../utils/audit');
const env = require('../../config/env');
const { hashPassword, comparePassword, evaluatePassword } = require('../../utils/password');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  generateOpaqueToken,
  hashOpaqueToken,
  generateTokenId,
  getRefreshTokenExpiryDate,
} = require('../../utils/token');

const GENERIC_AUTH_FAILURE_MESSAGE = 'Invalid email or password';
const GENERIC_FORGOT_RESPONSE = 'If the email exists, reset instructions will be sent.';
const GENERIC_VERIFICATION_RESPONSE = 'If the account can receive verification, a new link will be sent.';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
}

function buildEmailLookup(emailNormalized) {
  return {
    $or: [{ emailNormalized }, { email: emailNormalized }],
  };
}

function sanitizeUser(user) {
  return user?.toJSON ? user.toJSON() : user;
}

function getVerificationExpiryDate() {
  return new Date(Date.now() + env.auth.verificationTokenTtlMinutes * 60 * 1000);
}

function getResetExpiryDate() {
  return new Date(Date.now() + env.auth.resetTokenTtlMinutes * 60 * 1000);
}

function isEmailVerified(user) {
  return Boolean(user?.isEmailVerified || user?.isVerified);
}

function deriveActiveStatus(user) {
  if (user.accountStatus === 'disabled' || user.accountStatus === 'suspended' || user.accountStatus === 'deleted') {
    return user.accountStatus;
  }

  if (user.lockUntil && user.lockUntil > new Date()) {
    return 'locked';
  }

  if (!isEmailVerified(user) && env.auth.requireEmailVerification) {
    return 'pending_verification';
  }

  return 'active';
}

async function ensureUniqueUsername(candidateBase, fallbackBase = 'user') {
  const base = normalizeUsername(candidateBase) || normalizeUsername(fallbackBase) || 'user';

  let candidate = base.slice(0, 24);
  let suffix = 0;
  while (await User.exists({ username: candidate })) {
    suffix += 1;
    candidate = `${base.slice(0, Math.max(3, 24 - String(suffix).length))}${suffix}`;
  }
  return candidate;
}

async function prepareVerification(user) {
  const verificationToken = generateOpaqueToken();
  user.verificationTokenHash = hashOpaqueToken(verificationToken);
  user.verificationTokenExpiresAt = getVerificationExpiryDate();
  user.verificationEmailSentAt = new Date();
  await user.save();

  return verificationToken;
}

async function issueAuthTokens(user, options = {}) {
  const rememberMe = Boolean(options.rememberMe);
  const tokenId = generateTokenId();
  const accessToken = signAccessToken({
    sub: String(user._id),
    role: user.role,
    type: 'access',
    sv: user.sessionVersion || 0,
  });
  const refreshToken = signRefreshToken({
    sub: String(user._id),
    role: user.role,
    type: 'refresh',
    sv: user.sessionVersion || 0,
    jti: tokenId,
  }, { rememberMe });
  const tokenHash = hashOpaqueToken(refreshToken);

  const session = await AuthSession.create({
    userId: user._id,
    tokenHash,
    tokenId,
    sessionVersion: user.sessionVersion || 0,
    rememberMe,
    expiresAt: getRefreshTokenExpiryDate(rememberMe),
    createdIp: options.context?.ipAddress || '',
    lastUsedIp: options.context?.ipAddress || '',
    userAgent: options.context?.userAgent || '',
    lastUsedAt: new Date(),
  });

  return {
    tokens: {
      accessToken,
      refreshToken,
      accessTokenExpiresIn: env.jwt.accessExpiresIn,
      refreshTokenExpiresIn: rememberMe ? env.jwt.rememberMeRefreshExpiresIn : env.jwt.refreshExpiresIn,
    },
    sessionId: String(session._id),
  };
}

async function revokeRefreshSessionByToken(refreshToken, reason = 'logout') {
  if (!refreshToken) {
    return;
  }

  await AuthSession.findOneAndUpdate(
    { tokenHash: hashOpaqueToken(refreshToken), revokedAt: null },
    { revokedAt: new Date(), revokeReason: reason },
  );
}

async function revokeAllSessionsForUser(userId, reason = 'logout_all') {
  await AuthSession.updateMany(
    {
      userId,
      revokedAt: null,
    },
    {
      revokedAt: new Date(),
      revokeReason: reason,
    },
  );
}

async function incrementSessionVersion(userId) {
  await User.updateOne(
    { _id: userId },
    {
      $inc: { sessionVersion: 1 },
    },
  );
}

function buildAuthPayload(user, sessionData) {
  return {
    user: sanitizeUser(user),
    ...sessionData,
  };
}

async function resetFailedLoginState(user) {
  if (user.failedLoginAttempts || user.lockUntil || user.accountStatus === 'locked') {
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    user.accountStatus = isEmailVerified(user) || !env.auth.requireEmailVerification
      ? 'active'
      : 'pending_verification';
    user.isActive = user.accountStatus === 'active';
    await user.save();
  }
}

async function recordFailedLogin(user, context = {}) {
  if (!user) {
    auditLog('auth.login_failed', null, {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      reason: 'invalid_credentials',
      email: context.email || '',
    });
    return;
  }

  user.failedLoginAttempts = Number(user.failedLoginAttempts || 0) + 1;
  if (user.failedLoginAttempts >= env.auth.maxFailedLoginAttempts) {
    user.lockUntil = new Date(Date.now() + env.auth.accountLockMinutes * 60 * 1000);
    user.accountStatus = 'locked';
    user.isActive = false;
    auditLog('auth.account_locked', user._id, {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      failedLoginAttempts: user.failedLoginAttempts,
    });
  }

  await user.save();
  auditLog('auth.login_failed', user._id, {
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    reason: 'invalid_credentials',
  });
}

async function resolveRefreshSession(rawRefreshToken) {
  const decoded = verifyRefreshToken(rawRefreshToken);
  if (decoded.type !== 'refresh' || !decoded.jti) {
    throw new ApiError(401, 'Invalid refresh token');
  }

  const [user, session] = await Promise.all([
    User.findById(decoded.sub).select('+sessionVersion +lockUntil +failedLoginAttempts'),
    AuthSession.findOne({ tokenHash: hashOpaqueToken(rawRefreshToken) }).select('+tokenHash +replacedByTokenHash'),
  ]);

  if (!user) {
    throw new ApiError(401, 'Invalid refresh token');
  }

  if (String(decoded.sv ?? 0) !== String(user.sessionVersion || 0)) {
    throw new ApiError(401, 'Invalid refresh token');
  }

  if (!session) {
    throw new ApiError(401, 'Invalid refresh token');
  }

  if (session.revokedAt || session.expiresAt <= new Date() || session.tokenId !== decoded.jti) {
    if (session.revokedAt && session.replacedByTokenHash) {
      await revokeAllSessionsForUser(user._id, 'refresh_token_reuse_detected');
      await incrementSessionVersion(user._id);
      auditLog('auth.refresh_reuse_detected', user._id, {
        tokenId: decoded.jti,
      });
    }

    throw new ApiError(401, 'Invalid refresh token');
  }

  return { user, session, decoded };
}

function ensureActiveLoginState(user) {
  if (user.lockUntil && user.lockUntil > new Date()) {
    throw new ApiError(423, 'Your account is temporarily locked. Please try again later.');
  }

  const status = deriveActiveStatus(user);

  if (status === 'pending_verification') {
    throw new ApiError(403, 'Please verify your email before signing in.');
  }

  if (status !== 'active') {
    throw new ApiError(403, 'This account is not available.');
  }
}

async function register(payload, context = {}) {
  const emailNormalized = normalizeEmail(payload.email);
  const username = await ensureUniqueUsername(
    payload.username,
    payload.fullName?.replace(/\s+/g, '.') || emailNormalized.split('@')[0],
  );
  const existingUser = await User.findOne({
    $or: [{ emailNormalized }, { email: emailNormalized }, { username }],
  }).lean();

  if (existingUser) {
    throw new ApiError(409, 'An account with that email or username already exists.');
  }

  const passwordReview = evaluatePassword(payload.password, {
    email: emailNormalized,
    username,
    fullName: payload.fullName,
  });
  if (!passwordReview.isValid) {
    throw new ApiError(422, passwordReview.reasons[0]);
  }

  const shouldRequireVerification = env.auth.requireEmailVerification;
  const user = await User.create({
    fullName: String(payload.fullName || '').trim(),
    username,
    email: emailNormalized,
    emailNormalized,
    passwordHash: await hashPassword(payload.password),
    isVerified: !shouldRequireVerification,
    isEmailVerified: !shouldRequireVerification,
    accountStatus: shouldRequireVerification ? 'pending_verification' : 'active',
    isActive: !shouldRequireVerification,
    lastPasswordChangedAt: new Date(),
    sessionVersion: 0,
  });

  await PrivacySettings.create({ userId: user._id });

  let verificationToken = null;
  if (shouldRequireVerification) {
    verificationToken = await prepareVerification(user);
  }

  auditLog('auth.registration_created', user._id, {
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  if (shouldRequireVerification) {
    return {
      user: sanitizeUser(user),
      requiresEmailVerification: true,
      verificationPending: true,
      email: user.email,
      ...(process.env.NODE_ENV !== 'production' && verificationToken
        ? { devOnly: { verificationToken } }
        : {}),
    };
  }

  const sessionData = await issueAuthTokens(user, { context });
  return buildAuthPayload(user, sessionData);
}

async function login(payload, context = {}) {
  const emailNormalized = normalizeEmail(payload.email);
  const user = await User.findOne(buildEmailLookup(emailNormalized))
    .select('+passwordHash +failedLoginAttempts +lockUntil +sessionVersion');

  if (!user) {
    await recordFailedLogin(null, { ...context, email: emailNormalized });
    throw new ApiError(401, GENERIC_AUTH_FAILURE_MESSAGE);
  }

  if (user.lockUntil && user.lockUntil <= new Date()) {
    user.lockUntil = null;
    user.failedLoginAttempts = 0;
    if (user.accountStatus === 'locked') {
      user.accountStatus = isEmailVerified(user) || !env.auth.requireEmailVerification ? 'active' : 'pending_verification';
      user.isActive = user.accountStatus === 'active';
    }
  }

  const passwordMatches = await comparePassword(payload.password, user.passwordHash);
  if (!passwordMatches) {
    await recordFailedLogin(user, { ...context, email: emailNormalized });
    throw new ApiError(401, GENERIC_AUTH_FAILURE_MESSAGE);
  }

  ensureActiveLoginState(user);
  await resetFailedLoginState(user);

  user.lastLoginAt = new Date();
  await user.save();

  const sessionData = await issueAuthTokens(user, {
    rememberMe: payload.rememberMe,
    context,
  });

  auditLog('auth.login_success', user._id, {
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  return buildAuthPayload(user, sessionData);
}

async function getCurrentUser(userId) {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  return user;
}

async function changePassword(userId, payload, context = {}) {
  const user = await User.findById(userId).select('+passwordHash +sessionVersion');

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const matches = await comparePassword(payload.currentPassword, user.passwordHash);
  if (!matches) {
    throw new ApiError(400, 'Current password is incorrect');
  }

  const passwordReview = evaluatePassword(payload.newPassword, {
    email: user.emailNormalized || user.email,
    username: user.username,
    fullName: user.fullName,
  });
  if (!passwordReview.isValid) {
    throw new ApiError(422, passwordReview.reasons[0]);
  }

  user.passwordHash = await hashPassword(payload.newPassword);
  user.lastPasswordChangedAt = new Date();
  user.passwordResetTokenHash = null;
  user.passwordResetTokenExpiresAt = null;
  user.passwordResetRequestedAt = null;
  user.sessionVersion = Number(user.sessionVersion || 0) + 1;
  await user.save();
  await revokeAllSessionsForUser(userId, 'password_changed');

  auditLog('auth.change_password', userId, {
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  return { message: 'Password changed successfully' };
}

async function forgotPassword(payload, context = {}) {
  const emailNormalized = normalizeEmail(payload.email);
  const user = await User.findOne(buildEmailLookup(emailNormalized))
    .select('+passwordResetTokenHash +passwordResetTokenExpiresAt +passwordResetRequestedAt');

  if (!user) {
    auditLog('auth.password_reset_requested', null, {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      email: emailNormalized,
    });
    return { message: GENERIC_FORGOT_RESPONSE };
  }

  const token = generateOpaqueToken();
  user.passwordResetTokenHash = hashOpaqueToken(token);
  user.passwordResetTokenExpiresAt = getResetExpiryDate();
  user.passwordResetRequestedAt = new Date();
  await user.save();

  auditLog('auth.password_reset_requested', user._id, {
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  return {
    message: GENERIC_FORGOT_RESPONSE,
    ...(process.env.NODE_ENV !== 'production' ? { devOnly: { resetToken: token } } : {}),
  };
}

async function resetPassword(payload, context = {}) {
  const user = await User.findOne({
    passwordResetTokenHash: hashOpaqueToken(payload.token),
    passwordResetTokenExpiresAt: { $gt: new Date() },
  }).select('+passwordHash +passwordResetTokenHash +passwordResetTokenExpiresAt +sessionVersion');

  if (!user) {
    throw new ApiError(400, 'Invalid or expired reset token');
  }

  const passwordReview = evaluatePassword(payload.password, {
    email: user.emailNormalized || user.email,
    username: user.username,
    fullName: user.fullName,
  });
  if (!passwordReview.isValid) {
    throw new ApiError(422, passwordReview.reasons[0]);
  }

  user.passwordHash = await hashPassword(payload.password);
  user.passwordResetTokenHash = null;
  user.passwordResetTokenExpiresAt = null;
  user.passwordResetRequestedAt = null;
  user.lastPasswordChangedAt = new Date();
  user.sessionVersion = Number(user.sessionVersion || 0) + 1;
  await user.save();
  await revokeAllSessionsForUser(user._id, 'password_reset');

  auditLog('auth.password_reset_completed', user._id, {
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  return {
    message: 'Password reset successfully',
  };
}

async function verifyEmail(payload, context = {}) {
  const user = await User.findOne({
    verificationTokenHash: hashOpaqueToken(payload.token),
    verificationTokenExpiresAt: { $gt: new Date() },
  }).select('+verificationTokenHash +verificationTokenExpiresAt +sessionVersion');

  if (!user) {
    throw new ApiError(400, 'Invalid or expired verification token');
  }

  user.isVerified = true;
  user.isEmailVerified = true;
  user.verificationTokenHash = null;
  user.verificationTokenExpiresAt = null;
  user.verificationEmailSentAt = null;
  user.accountStatus = 'active';
  user.isActive = true;
  await user.save();

  const sessionData = await issueAuthTokens(user, { context });

  auditLog('auth.email_verified', user._id, {
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  return {
    ...buildAuthPayload(user, sessionData),
    message: 'Email verified successfully',
  };
}

async function resendVerification(userId, payload = {}, context = {}) {
  const query = userId ? { _id: userId } : buildEmailLookup(normalizeEmail(payload.email));
  const user = await User.findOne(query)
    .select('+verificationTokenHash +verificationTokenExpiresAt +verificationEmailSentAt');

  if (!user || isEmailVerified(user)) {
    return { message: GENERIC_VERIFICATION_RESPONSE };
  }

  const lastSentAt = user.verificationEmailSentAt ? new Date(user.verificationEmailSentAt).getTime() : 0;
  const cooldownMs = env.auth.resendVerificationCooldownSeconds * 1000;
  if (lastSentAt && (Date.now() - lastSentAt) < cooldownMs) {
    return { message: GENERIC_VERIFICATION_RESPONSE };
  }

  const verificationToken = await prepareVerification(user);

  auditLog('auth.verification_resent', user._id, {
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  return {
    message: GENERIC_VERIFICATION_RESPONSE,
    ...(process.env.NODE_ENV !== 'production' ? { devOnly: { verificationToken } } : {}),
  };
}

async function refreshToken(payload, context = {}) {
  if (!payload.refreshToken) {
    throw new ApiError(401, 'Refresh token is required');
  }

  const { user, session } = await resolveRefreshSession(payload.refreshToken);
  ensureActiveLoginState(user);
  await resetFailedLoginState(user);

  const nextSessionData = await issueAuthTokens(user, {
    rememberMe: session.rememberMe,
    context,
  });
  session.revokedAt = new Date();
  session.replacedByTokenHash = hashOpaqueToken(nextSessionData.tokens.refreshToken);
  session.revokeReason = 'rotated';
  session.lastUsedAt = new Date();
  session.lastUsedIp = context.ipAddress || session.lastUsedIp;
  await session.save();

  auditLog('auth.token_refreshed', user._id, {
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  return nextSessionData;
}

async function logout(payload = {}, context = {}) {
  if (payload.refreshToken) {
    await revokeRefreshSessionByToken(payload.refreshToken, 'logout');
  }

  if (context.userId) {
    auditLog('auth.logout', context.userId, {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }

  return {
    message: 'Logged out successfully',
  };
}

async function logoutAll(userId, context = {}) {
  await revokeAllSessionsForUser(userId, 'logout_all');
  await incrementSessionVersion(userId);

  auditLog('auth.logout_all', userId, {
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  return { message: 'Logged out from all devices successfully' };
}

module.exports = {
  register,
  login,
  getCurrentUser,
  changePassword,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  refreshToken,
  logout,
  logoutAll,
};
