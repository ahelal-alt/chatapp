const Contact = require('../modules/contacts/contact.model');
const PrivacySettings = require('../modules/privacy/privacy.model');
const User = require('../modules/users/user.model');
const ApiError = require('./ApiError');
const { assertNotBlocked, isBlocked } = require('./blockCheck');

async function ensureActiveUser(userId, message = 'User not found') {
  const user = await User.findById(userId);

  if (!user || !user.isActive) {
    throw new ApiError(404, message);
  }

  return user;
}

async function areContacts(userId, otherUserId) {
  const contact = await Contact.findOne({
    userId,
    contactUserId: otherUserId,
  }).lean();

  return Boolean(contact);
}

async function getPrivacySettings(userId) {
  return PrivacySettings.findOne({ userId }).lean();
}

function canAccessVisibility(privacyValue, isSelf, isContact) {
  if (isSelf) {
    return true;
  }

  if (privacyValue === 'everyone') {
    return true;
  }

  if (privacyValue === 'contacts') {
    return isContact;
  }

  return false;
}

async function buildViewerPrivacyContext(viewerId, targetUserId) {
  const isSelf = String(viewerId) === String(targetUserId);
  const [privacy, contact, blocked] = await Promise.all([
    getPrivacySettings(targetUserId),
    isSelf ? Promise.resolve(true) : areContacts(viewerId, targetUserId),
    isSelf ? Promise.resolve(false) : isBlocked(viewerId, targetUserId),
  ]);

  return {
    isSelf,
    isContact: Boolean(contact),
    blocked,
    privacy: privacy || {},
  };
}

async function buildPresencePayloadForViewer(viewerId, targetUserId, isOnline, lastSeen = null) {
  const context = await buildViewerPrivacyContext(viewerId, targetUserId);

  if (context.blocked && !context.isSelf) {
    return {
      userId: targetUserId,
      isOnline: false,
      lastSeen: null,
    };
  }

  return {
    userId: targetUserId,
    isOnline: canAccessVisibility(
      context.privacy.onlineStatusVisibility || 'contacts',
      context.isSelf,
      context.isContact,
    ) ? isOnline : false,
    lastSeen: canAccessVisibility(
      context.privacy.lastSeenVisibility || 'contacts',
      context.isSelf,
      context.isContact,
    ) ? lastSeen : null,
  };
}

async function getMessagingPrivacySettings(userId) {
  const privacy = await getPrivacySettings(userId);

  return {
    readReceiptsEnabled: privacy?.readReceiptsEnabled ?? true,
    typingIndicatorEnabled: privacy?.typingIndicatorEnabled ?? true,
  };
}

async function ensurePrivateMessagingAllowed(requesterId, targetUserId) {
  await assertNotBlocked(requesterId, targetUserId, 'Private messaging is blocked between these users');

  const target = await ensureActiveUser(targetUserId, 'Target user not found');
  const isContact = await areContacts(requesterId, targetUserId);

  if (isContact) {
    return target;
  }

  const privacy = await getPrivacySettings(targetUserId);
  const permission = privacy?.messagePermission || 'contacts';

  if (permission !== 'everyone') {
    throw new ApiError(403, 'You can only message this user after becoming contacts');
  }

  return target;
}

async function ensureGroupInviteAllowed(actorId, targetUserId) {
  await assertNotBlocked(actorId, targetUserId, 'Cannot add a blocked user to a group');
  await ensureActiveUser(targetUserId, 'Target user not found');

  if (String(actorId) === String(targetUserId)) {
    return;
  }

  const privacy = await getPrivacySettings(targetUserId);
  const permission = privacy?.groupInvitePermission || 'contacts';

  if (permission === 'everyone') {
    return;
  }

  const isContact = await areContacts(actorId, targetUserId);
  if (!isContact) {
    throw new ApiError(403, 'You can only add this user to groups after becoming contacts');
  }
}

async function ensureGroupInvitesAllowed(actorId, targetUserIds) {
  const uniqueTargetIds = [...new Set((targetUserIds || []).map(String))]
    .filter((targetUserId) => String(targetUserId) !== String(actorId));

  for (const targetUserId of uniqueTargetIds) {
    await ensureGroupInviteAllowed(actorId, targetUserId);
  }
}

module.exports = {
  ensureActiveUser,
  areContacts,
  getPrivacySettings,
  canAccessVisibility,
  buildViewerPrivacyContext,
  buildPresencePayloadForViewer,
  getMessagingPrivacySettings,
  ensurePrivateMessagingAllowed,
  ensureGroupInviteAllowed,
  ensureGroupInvitesAllowed,
};
