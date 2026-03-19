const User = require('./user.model');
const Contact = require('../contacts/contact.model');
const PrivacySettings = require('../privacy/privacy.model');
const ApiError = require('../../utils/ApiError');
const { getPagination, buildPaginationMeta } = require('../../utils/pagination');
const { isBlocked } = require('../../utils/blockCheck');
const { escapeRegex } = require('../../utils/validation');

async function getUserPrivacy(userId) {
  let privacy = await PrivacySettings.findOne({ userId });

  if (!privacy) {
    privacy = await PrivacySettings.create({ userId });
  }

  return privacy;
}

async function areContacts(userId, otherUserId) {
  const contact = await Contact.findOne({
    userId,
    contactUserId: otherUserId,
  }).lean();

  return Boolean(contact);
}

function mapVisibility(privacyValue, isSelf, isContact) {
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

async function buildPublicProfile(viewerId, user) {
  const privacy = await getUserPrivacy(user._id);
  const self = viewerId && String(viewerId) === String(user._id);
  const contact = self ? true : viewerId ? await areContacts(viewerId, user._id) : false;
  const blocked = viewerId ? await isBlocked(viewerId, user._id) : false;

  if (blocked && !self) {
    throw new ApiError(403, 'You cannot view this profile');
  }

  const raw = user.toJSON();

  if (!mapVisibility(privacy.profilePhotoVisibility, self, contact)) {
    raw.profileImage = '';
  }

  if (!mapVisibility(privacy.lastSeenVisibility, self, contact)) {
    raw.lastSeen = null;
  }

  if (!mapVisibility(privacy.onlineStatusVisibility, self, contact)) {
    raw.isOnline = false;
  }

  return raw;
}

async function getMyProfile(userId) {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const privacy = await getUserPrivacy(userId);

  return {
    user,
    privacy,
  };
}

async function updateMyProfile(userId, payload) {
  const allowedFields = ['fullName', 'bio', 'location', 'statusMessage', 'profileImage'];
  const update = {};

  for (const field of allowedFields) {
    if (payload[field] !== undefined) {
      update[field] = payload[field];
    }
  }

  const user = await User.findByIdAndUpdate(userId, update, {
    new: true,
    runValidators: true,
  });

  return user;
}

async function updateProfileImage(userId, profileImage) {
  const user = await User.findByIdAndUpdate(
    userId,
    { profileImage },
    { new: true, runValidators: true },
  );

  return user;
}

async function getPublicProfile(viewerId, userId) {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  return buildPublicProfile(viewerId, user);
}

async function searchUsers(viewerId, queryParams) {
  const { page, limit, skip } = getPagination(queryParams);
  const searchRegex = new RegExp(escapeRegex(queryParams.query), 'i');
  const criteria = {
    _id: { $ne: viewerId },
    isActive: true,
    $or: [{ username: searchRegex }, { fullName: searchRegex }],
  };

  const [users, total] = await Promise.all([
    User.find(criteria)
      .sort({ username: 1 })
      .skip(skip)
      .limit(limit),
    User.countDocuments(criteria),
  ]);

  const results = [];
  for (const user of users) {
    results.push(await buildPublicProfile(viewerId, user));
  }

  return {
    items: results,
    meta: buildPaginationMeta({ page, limit, total }),
  };
}

async function getMutualContacts(userId, otherUserId) {
  const myContacts = await Contact.find({ userId }).lean();
  const otherContacts = await Contact.find({ userId: otherUserId }).lean();
  const otherSet = new Set(otherContacts.map((contact) => String(contact.contactUserId)));

  const mutualIds = myContacts
    .map((contact) => String(contact.contactUserId))
    .filter((contactUserId) => otherSet.has(contactUserId));

  const users = await User.find({ _id: { $in: mutualIds } }).select('fullName username profileImage');

  return users;
}

async function saveMyEncryptionKey(userId, payload) {
  const user = await User.findByIdAndUpdate(
    userId,
    {
      encryptionPublicKey: payload.publicKey,
      encryptionKeyVersion: payload.keyVersion || 1,
      encryptionEnabled: true,
    },
    { new: true, runValidators: true },
  );

  return {
    encryptionEnabled: Boolean(user?.encryptionEnabled),
    encryptionPublicKey: user?.encryptionPublicKey || '',
    encryptionKeyVersion: user?.encryptionKeyVersion || 0,
  };
}

async function getUserEncryptionKey(viewerId, userId) {
  const user = await User.findById(userId).select('fullName encryptionPublicKey encryptionKeyVersion encryptionEnabled isActive');

  if (!user || !user.isActive) {
    throw new ApiError(404, 'User not found');
  }

  if (viewerId && String(viewerId) !== String(userId) && await isBlocked(viewerId, userId)) {
    throw new ApiError(403, 'You cannot access this encryption key');
  }

  return {
    userId: user._id,
    fullName: user.fullName,
    encryptionEnabled: Boolean(user.encryptionEnabled),
    publicKey: user.encryptionPublicKey || '',
    keyVersion: user.encryptionKeyVersion || 0,
  };
}

module.exports = {
  getUserPrivacy,
  areContacts,
  getMyProfile,
  updateMyProfile,
  updateProfileImage,
  getPublicProfile,
  searchUsers,
  getMutualContacts,
  saveMyEncryptionKey,
  getUserEncryptionKey,
};
