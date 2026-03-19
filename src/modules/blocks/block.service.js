const Block = require('./block.model');
const Contact = require('../contacts/contact.model');
const ContactRequest = require('../contacts/contactRequest.model');
const User = require('../users/user.model');
const ApiError = require('../../utils/ApiError');
const { getPagination, buildPaginationMeta } = require('../../utils/pagination');
const auditLog = require('../../utils/audit');

async function blockUser(blockerUserId, blockedUserId) {
  if (String(blockerUserId) === String(blockedUserId)) {
    throw new ApiError(400, 'You cannot block yourself');
  }

  const target = await User.findById(blockedUserId);
  if (!target) {
    throw new ApiError(404, 'User not found');
  }

  const block = await Block.findOneAndUpdate(
    { blockerUserId, blockedUserId },
    { blockerUserId, blockedUserId },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  await Promise.all([
    Contact.deleteMany({
      $or: [
        { userId: blockerUserId, contactUserId: blockedUserId },
        { userId: blockedUserId, contactUserId: blockerUserId },
      ],
    }),
    ContactRequest.updateMany(
      {
        status: 'pending',
        $or: [
          { senderId: blockerUserId, receiverId: blockedUserId },
          { senderId: blockedUserId, receiverId: blockerUserId },
        ],
      },
      { status: 'cancelled' },
    ),
  ]);

  auditLog('block.create', blockerUserId, { blockedUserId });

  return block;
}

async function unblockUser(blockerUserId, blockedUserId) {
  const deleted = await Block.findOneAndDelete({ blockerUserId, blockedUserId });

  if (!deleted) {
    throw new ApiError(404, 'Block not found');
  }

  auditLog('block.delete', blockerUserId, { blockedUserId });
}

async function listBlockedUsers(userId, query) {
  const { page, limit, skip } = getPagination(query);
  const criteria = { blockerUserId: userId };

  const [items, total] = await Promise.all([
    Block.find(criteria)
      .populate('blockedUserId', 'fullName username profileImage')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Block.countDocuments(criteria),
  ]);

  return {
    items,
    meta: buildPaginationMeta({ page, limit, total }),
  };
}

module.exports = {
  blockUser,
  unblockUser,
  listBlockedUsers,
};

