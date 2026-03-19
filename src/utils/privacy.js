const Contact = require('../modules/contacts/contact.model');
const PrivacySettings = require('../modules/privacy/privacy.model');
const User = require('../modules/users/user.model');
const ApiError = require('./ApiError');
const { assertNotBlocked } = require('./blockCheck');

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
  ensurePrivateMessagingAllowed,
  ensureGroupInviteAllowed,
  ensureGroupInvitesAllowed,
};
