const User = require('../users/user.model');
const Report = require('../reports/report.model');
const Message = require('../messages/message.model');
const ApiError = require('../../utils/ApiError');
const auditLog = require('../../utils/audit');
const { getPagination, buildPaginationMeta } = require('../../utils/pagination');

async function listUsers(query) {
  const { page, limit, skip } = getPagination(query);
  const [items, total] = await Promise.all([
    User.find().sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(),
  ]);

  return {
    items,
    meta: buildPaginationMeta({ page, limit, total }),
  };
}

async function listReports(query) {
  const { page, limit, skip } = getPagination(query);
  const [items, total] = await Promise.all([
    Report.find().sort({ createdAt: -1 }).skip(skip).limit(limit)
      .populate('reporterUserId', 'fullName username')
      .populate('targetUserId', 'fullName username')
      .populate('targetMessageId'),
    Report.countDocuments(),
  ]);

  return {
    items,
    meta: buildPaginationMeta({ page, limit, total }),
  };
}

async function setUserStatus(adminUserId, userId, isActive) {
  const user = await User.findByIdAndUpdate(userId, { isActive }, { new: true });

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  auditLog('admin.user_status', adminUserId, { userId, isActive });

  return user;
}

async function deleteMessage(adminUserId, messageId) {
  const message = await Message.findById(messageId);
  if (!message) {
    throw new ApiError(404, 'Message not found');
  }

  message.deletedForEveryone = true;
  await message.save();

  auditLog('admin.delete_message', adminUserId, { messageId });
}

module.exports = {
  listUsers,
  listReports,
  setUserStatus,
  deleteMessage,
};

