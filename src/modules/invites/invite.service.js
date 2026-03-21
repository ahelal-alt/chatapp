const Invite = require('./invite.model');
const User = require('../users/user.model');
const authService = require('../auth/auth.service');
const ApiError = require('../../utils/ApiError');
const auditLog = require('../../utils/audit');
const env = require('../../config/env');
const { getPagination, buildPaginationMeta } = require('../../utils/pagination');
const { generateOpaqueToken, hashOpaqueToken } = require('../../utils/token');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function inviteExpiryDate() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

function buildInviteUrl(token) {
  return `${String(env.clientUrl || '').replace(/\/$/, '')}/invites/${token}`;
}

function buildWorkspaceSummary() {
  return {
    name: env.appName,
    type: 'workspace',
  };
}

function buildInviterSummary(inviter) {
  if (!inviter) {
    return null;
  }

  return {
    id: inviter._id,
    fullName: inviter.fullName,
    username: inviter.username,
    profileImage: inviter.profileImage || '',
  };
}

function coerceInviteStatus(invite) {
  if (!invite) {
    return 'invalid';
  }

  if (invite.status === 'pending' && invite.expiresAt && invite.expiresAt <= new Date()) {
    return 'expired';
  }

  return invite.status;
}

async function findInviteByToken(rawToken, options = {}) {
  let inviteQuery = Invite.findOne({ tokenHash: hashOpaqueToken(rawToken) });

  if (inviteQuery && typeof inviteQuery.select === 'function' && options.selectTokenHash) {
    inviteQuery = inviteQuery.select('+tokenHash');
  }

  if (inviteQuery && typeof inviteQuery.populate === 'function') {
    inviteQuery = inviteQuery
      .populate('invitedByUserId', 'fullName username profileImage')
      .populate('acceptedByUserId', 'fullName username email');
  }

  const invite = await inviteQuery;

  if (!invite) {
    return null;
  }

  if (invite.status === 'pending' && invite.expiresAt && invite.expiresAt <= new Date()) {
    invite.status = 'expired';
    if (typeof invite.save === 'function') {
      await invite.save();
    }
  }

  return invite;
}

async function findAccountForInvite(invite) {
  if (!invite?.emailNormalized) {
    return null;
  }

  return User.findOne({
    $or: [{ emailNormalized: invite.emailNormalized }, { email: invite.emailNormalized }],
  }).select('fullName username email emailNormalized accountStatus isEmailVerified isVerified isActive');
}

function buildNextAction(status, options = {}) {
  const {
    accountExists = false,
    viewerUser = null,
    invite = null,
  } = options;

  if (status === 'invalid') {
    return 'invalid_invite';
  }
  if (status === 'expired') {
    return 'invite_expired';
  }
  if (status === 'revoked') {
    return 'invite_revoked';
  }
  if (status === 'accepted') {
    if (viewerUser && invite?.acceptedByUserId && String(invite.acceptedByUserId._id || invite.acceptedByUserId) === String(viewerUser._id)) {
      return 'open_app';
    }
    return 'sign_in';
  }
  if (viewerUser) {
    const viewerEmail = normalizeEmail(viewerUser.emailNormalized || viewerUser.email);
    if (invite?.emailNormalized && viewerEmail === invite.emailNormalized) {
      return 'accept_invite';
    }
    return 'switch_account';
  }
  return accountExists ? 'sign_in' : 'register';
}

function buildPublicInvitePayload(invite, options = {}) {
  const account = options.account || null;
  const viewerUser = options.viewerUser || null;
  const status = coerceInviteStatus(invite);

  if (!invite) {
    return {
      status: 'invalid',
      authRequired: false,
      accountExists: false,
      nextAction: 'invalid_invite',
      workspace: buildWorkspaceSummary(),
      inviter: null,
      role: 'member',
    };
  }

  const viewerEmail = viewerUser ? normalizeEmail(viewerUser.emailNormalized || viewerUser.email) : '';
  const invitedEmail = invite.emailNormalized || normalizeEmail(invite.email);
  const matchesViewer = Boolean(viewerUser && viewerEmail === invitedEmail);
  const accountExists = Boolean(account);
  const nextAction = buildNextAction(status, {
    accountExists,
    viewerUser,
    invite,
  });

  return {
    id: invite._id,
    email: invitedEmail,
    status,
    role: 'member',
    inviter: buildInviterSummary(invite.invitedByUserId),
    workspace: buildWorkspaceSummary(),
    acceptedAt: invite.acceptedAt || null,
    expiresAt: invite.expiresAt || null,
    authRequired: status === 'pending' && accountExists && !matchesViewer,
    accountExists,
    nextAction,
    canRegister: status === 'pending' && !accountExists,
    canLogin: status === 'pending' && accountExists,
    canAccept: status === 'pending' && matchesViewer,
    isSignedInAsInvitedUser: matchesViewer,
  };
}

function assertInviteUsable(invite) {
  if (!invite) {
    throw new ApiError(404, 'Invite not found');
  }

  const status = coerceInviteStatus(invite);
  if (status === 'revoked') {
    throw new ApiError(410, 'This invite has been revoked');
  }
  if (status === 'expired') {
    throw new ApiError(410, 'This invite has expired');
  }
  if (status === 'accepted') {
    throw new ApiError(409, 'This invite has already been accepted');
  }
  if (status !== 'pending') {
    throw new ApiError(400, 'This invite is not available');
  }
}

async function acceptInviteForUser(userId, rawToken, context = {}, options = {}) {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const invite = await findInviteByToken(rawToken, { selectTokenHash: true });
  if (!invite) {
    throw new ApiError(400, 'Invalid or expired invite token');
  }

  const status = coerceInviteStatus(invite);
  if (status === 'accepted') {
    if (String(invite.acceptedByUserId?._id || invite.acceptedByUserId || '') === String(userId)) {
      return invite;
    }
    throw new ApiError(409, 'This invite has already been accepted');
  }

  assertInviteUsable(invite);

  if (invite.emailNormalized !== normalizeEmail(user.emailNormalized || user.email)) {
    if (options.failWithPayload) {
      const account = await findAccountForInvite(invite);
      return {
        accepted: false,
        invite: buildPublicInvitePayload(invite, { account, viewerUser: user }),
      };
    }
    throw new ApiError(403, 'This invite does not belong to your account');
  }

  invite.status = 'accepted';
  invite.acceptedByUserId = userId;
  invite.acceptedAt = new Date();
  await invite.save();

  auditLog('invite.accepted', userId, {
    inviteId: invite._id,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    publicFlow: Boolean(options.publicFlow),
  });

  return invite;
}

async function listInvites(userId, query) {
  const { page, limit, skip } = getPagination(query);
  const criteria = { invitedByUserId: userId };
  if (query.status) {
    criteria.status = query.status;
  }

  const [items, total] = await Promise.all([
    Invite.find(criteria)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('acceptedByUserId', 'fullName username email'),
    Invite.countDocuments(criteria),
  ]);

  return {
    items,
    meta: buildPaginationMeta({ page, limit, total }),
  };
}

async function createInvite(userId, payload) {
  const emailNormalized = normalizeEmail(payload.email);
  const existingPending = await Invite.findOne({
    invitedByUserId: userId,
    emailNormalized,
    status: 'pending',
  }).lean();
  if (existingPending) {
    throw new ApiError(409, 'An invite is already pending for that email');
  }

  const token = generateOpaqueToken();
  const invite = await Invite.create({
    email: emailNormalized,
    emailNormalized,
    invitedByUserId: userId,
    tokenHash: hashOpaqueToken(token),
    status: 'pending',
    expiresAt: inviteExpiryDate(),
    lastSentAt: new Date(),
  });

  auditLog('invite.created', userId, {
    inviteId: invite._id,
    emailNormalized,
  });

  return {
    invite,
    inviteUrl: buildInviteUrl(token),
    ...(process.env.NODE_ENV !== 'production' ? { devOnly: { token } } : {}),
  };
}

async function getInviteDetails(userId, inviteId) {
  const invite = await Invite.findOne({ _id: inviteId, invitedByUserId: userId }).populate('acceptedByUserId', 'fullName username email');
  if (!invite) {
    throw new ApiError(404, 'Invite not found');
  }

  return invite;
}

async function resendInvite(userId, inviteId) {
  const invite = await Invite.findOne({ _id: inviteId, invitedByUserId: userId }).select('+tokenHash');
  if (!invite) {
    throw new ApiError(404, 'Invite not found');
  }
  if (coerceInviteStatus(invite) !== 'pending') {
    throw new ApiError(400, 'Only pending invites can be resent');
  }

  const token = generateOpaqueToken();
  invite.tokenHash = hashOpaqueToken(token);
  invite.expiresAt = inviteExpiryDate();
  invite.lastSentAt = new Date();
  await invite.save();

  auditLog('invite.resent', userId, { inviteId });

  return {
    invite,
    inviteUrl: buildInviteUrl(token),
    ...(process.env.NODE_ENV !== 'production' ? { devOnly: { token } } : {}),
  };
}

async function revokeInvite(userId, inviteId) {
  const invite = await Invite.findOne({ _id: inviteId, invitedByUserId: userId });
  if (!invite) {
    throw new ApiError(404, 'Invite not found');
  }
  if (coerceInviteStatus(invite) !== 'pending') {
    throw new ApiError(400, 'Only pending invites can be revoked');
  }

  invite.status = 'revoked';
  invite.revokedAt = new Date();
  await invite.save();

  auditLog('invite.revoked', userId, { inviteId });
  return { message: 'Invite revoked successfully' };
}

async function acceptInvite(userId, payload, context = {}) {
  const invite = await acceptInviteForUser(userId, payload.token, context);
  return invite;
}

async function getPublicInvite(rawToken, viewerUser = null) {
  const invite = await findInviteByToken(rawToken);
  const account = invite ? await findAccountForInvite(invite) : null;

  return buildPublicInvitePayload(invite, {
    account,
    viewerUser,
  });
}

async function registerFromPublicInvite(rawToken, payload, context = {}) {
  const invite = await findInviteByToken(rawToken, { selectTokenHash: true });
  assertInviteUsable(invite);

  if (payload.email && normalizeEmail(payload.email) !== invite.emailNormalized) {
    throw new ApiError(422, 'Use the invited email address to continue.');
  }

  const existingUser = await findAccountForInvite(invite);
  if (existingUser) {
    throw new ApiError(409, 'An account already exists for this invite. Please sign in instead.');
  }

  const auth = await authService.register({
    ...payload,
    email: invite.emailNormalized,
  }, context, {
    forcedEmail: invite.emailNormalized,
    skipEmailVerification: true,
    createdBy: invite.invitedByUserId?._id || invite.invitedByUserId || null,
  });

  const acceptedInvite = await acceptInviteForUser(auth.user._id, rawToken, context, {
    publicFlow: true,
  });

  return {
    invite: buildPublicInvitePayload(acceptedInvite, {
      account: auth.user,
      viewerUser: auth.user,
    }),
    auth,
  };
}

async function loginFromPublicInvite(rawToken, payload, context = {}) {
  const invite = await findInviteByToken(rawToken, { selectTokenHash: true });
  if (!invite) {
    throw new ApiError(400, 'Invalid or expired invite token');
  }
  const inviteStatus = coerceInviteStatus(invite);
  if (!['pending', 'accepted'].includes(inviteStatus)) {
    assertInviteUsable(invite);
  }

  if (payload.email && normalizeEmail(payload.email) !== invite.emailNormalized) {
    throw new ApiError(422, 'Use the invited email address to continue.');
  }

  const auth = await authService.login({
    email: invite.emailNormalized,
    password: payload.password,
    rememberMe: payload.rememberMe,
  }, context, {
    forcedEmail: invite.emailNormalized,
    skipEmailVerification: true,
  });

  let acceptedInvite = invite;
  if (inviteStatus === 'pending') {
    acceptedInvite = await acceptInviteForUser(auth.user._id, rawToken, context, {
      publicFlow: true,
    });
  }

  return {
    invite: buildPublicInvitePayload(acceptedInvite, {
      account: auth.user,
      viewerUser: auth.user,
    }),
    auth,
  };
}

async function acceptPublicInvite(rawToken, userId, context = {}) {
  if (!userId) {
    const invite = await findInviteByToken(rawToken);
    const account = invite ? await findAccountForInvite(invite) : null;

    return {
      accepted: false,
      invite: buildPublicInvitePayload(invite, { account }),
    };
  }

  const invite = await acceptInviteForUser(userId, rawToken, context, {
    publicFlow: true,
    failWithPayload: true,
  });

  if (invite.accepted === false) {
    return invite;
  }

  const user = await User.findById(userId);
  const account = invite ? await findAccountForInvite(invite) : null;

  return {
    accepted: true,
    invite: buildPublicInvitePayload(invite, {
      account,
      viewerUser: user,
    }),
  };
}

module.exports = {
  listInvites,
  createInvite,
  getInviteDetails,
  resendInvite,
  revokeInvite,
  acceptInvite,
  getPublicInvite,
  registerFromPublicInvite,
  loginFromPublicInvite,
  acceptPublicInvite,
  acceptInviteForUser,
};
