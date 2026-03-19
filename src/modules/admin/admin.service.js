const User = require('../users/user.model');
const Report = require('../reports/report.model');
const Message = require('../messages/message.model');
const Chat = require('../chats/chat.model');
const Group = require('../groups/group.model');
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

async function getDashboardSummary() {
  const startOfWindow = new Date();
  startOfWindow.setDate(startOfWindow.getDate() - 7);
  startOfWindow.setHours(0, 0, 0, 0);

  const [
    totalUsers,
    activeUsers,
    suspendedUsers,
    totalChats,
    totalGroups,
    totalReports,
    totalMessages,
    recentRegistrations,
    recentMessagesByDay,
    moderationUsers,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ isOnline: true, isActive: true }),
    User.countDocuments({ isActive: false }),
    Chat.countDocuments(),
    Group.countDocuments(),
    Report.countDocuments(),
    Message.countDocuments({ deletedForEveryone: false }),
    User.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .select('fullName username email role isActive createdAt isOnline'),
    Message.aggregate([
      {
        $match: {
          deletedForEveryone: false,
          createdAt: { $gte: startOfWindow },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' },
          },
          count: { $sum: 1 },
        },
      },
      {
        $sort: {
          '_id.year': 1,
          '_id.month': 1,
          '_id.day': 1,
        },
      },
    ]),
    User.find()
      .sort({ createdAt: -1 })
      .limit(20)
      .select('fullName username email role isActive isOnline createdAt'),
  ]);

  return {
    totals: {
      users: totalUsers,
      activeUsers,
      suspendedUsers,
      chats: totalChats,
      groups: totalGroups,
      reports: totalReports,
      messages: totalMessages,
    },
    dailyMessages: recentMessagesByDay.map((item) => ({
      date: `${item._id.year}-${String(item._id.month).padStart(2, '0')}-${String(item._id.day).padStart(2, '0')}`,
      count: item.count,
    })),
    recentRegistrations,
    moderationUsers,
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
  getDashboardSummary,
  listUsers,
  listReports,
  setUserStatus,
  deleteMessage,
};
