const Invite = require('./invite.model');
const User = require('../users/user.model');
const ApiError = require('../../utils/ApiError');
const auditLog = require('../../utils/audit');
const { getPagination, buildPaginationMeta } = require('../../utils/pagination');
const { generateOpaqueToken, hashOpaqueToken } = require('../../utils/token');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function inviteExpiryDate() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
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
  const existingUser = await User.findOne({ $or: [{ emailNormalized }, { email: emailNormalized }] }).lean();
  if (existingUser) {
    throw new ApiError(409, 'That email already belongs to an account');
  }

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
  if (invite.status !== 'pending') {
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
    ...(process.env.NODE_ENV !== 'production' ? { devOnly: { token } } : {}),
  };
}

async function revokeInvite(userId, inviteId) {
  const invite = await Invite.findOne({ _id: inviteId, invitedByUserId: userId });
  if (!invite) {
    throw new ApiError(404, 'Invite not found');
  }
  if (invite.status !== 'pending') {
    throw new ApiError(400, 'Only pending invites can be revoked');
  }

  invite.status = 'revoked';
  invite.revokedAt = new Date();
  await invite.save();

  auditLog('invite.revoked', userId, { inviteId });
  return { message: 'Invite revoked successfully' };
}

async function acceptInvite(userId, payload) {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const invite = await Invite.findOne({
    tokenHash: hashOpaqueToken(payload.token),
    status: 'pending',
    expiresAt: { $gt: new Date() },
  });
  if (!invite) {
    throw new ApiError(400, 'Invalid or expired invite token');
  }

  if (invite.emailNormalized !== (user.emailNormalized || user.email)) {
    throw new ApiError(403, 'This invite does not belong to your account');
  }

  invite.status = 'accepted';
  invite.acceptedByUserId = userId;
  invite.acceptedAt = new Date();
  await invite.save();

  auditLog('invite.accepted', userId, { inviteId: invite._id });
  return invite;
}

module.exports = {
  listInvites,
  createInvite,
  getInviteDetails,
  resendInvite,
  revokeInvite,
  acceptInvite,
};
