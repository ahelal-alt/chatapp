const User = require('../users/user.model');
const Report = require('../reports/report.model');
const Message = require('../messages/message.model');
const Chat = require('../chats/chat.model');
const Group = require('../groups/group.model');
const AuthSession = require('../auth/authSession.model');
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

async function getAnalytics(query = {}) {
  const days = Number(query.days || 30);
  const startOfWindow = new Date();
  startOfWindow.setDate(startOfWindow.getDate() - days + 1);
  startOfWindow.setHours(0, 0, 0, 0);

  const [messagesByDay, usersByDay, reportsByStatus] = await Promise.all([
    Message.aggregate([
      { $match: { createdAt: { $gte: startOfWindow }, deletedForEveryone: false } },
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
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
    ]),
    User.aggregate([
      { $match: { createdAt: { $gte: startOfWindow } } },
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
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
    ]),
    Report.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  return {
    rangeDays: days,
    messagesByDay: messagesByDay.map((item) => ({
      date: `${item._id.year}-${String(item._id.month).padStart(2, '0')}-${String(item._id.day).padStart(2, '0')}`,
      count: item.count,
    })),
    registrationsByDay: usersByDay.map((item) => ({
      date: `${item._id.year}-${String(item._id.month).padStart(2, '0')}-${String(item._id.day).padStart(2, '0')}`,
      count: item.count,
    })),
    reportsByStatus: reportsByStatus.map((item) => ({
      status: item._id || 'unknown',
      count: item.count,
    })),
  };
}

async function getUserDetails(userId) {
  const user = await User.findById(userId).select('+lockUntil +failedLoginAttempts +lastPasswordChangedAt +sessionVersion +approvedBy +createdBy');
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const [reportCount, chatCount] = await Promise.all([
    Report.countDocuments({
      $or: [{ targetUserId: userId }, { reporterUserId: userId }],
    }),
    Chat.countDocuments({ memberIds: userId }),
  ]);

  return {
    user: user.toJSON(),
    security: {
      failedLoginAttempts: user.failedLoginAttempts || 0,
      lockUntil: user.lockUntil,
      lastPasswordChangedAt: user.lastPasswordChangedAt,
      sessionVersion: user.sessionVersion || 0,
    },
    summary: {
      reports: reportCount,
      chats: chatCount,
    },
  };
}

async function getReportDetails(reportId) {
  const report = await Report.findById(reportId)
    .populate('reporterUserId', 'fullName username email profileImage')
    .populate('reviewedByUserId', 'fullName username email')
    .populate('targetUserId', 'fullName username email profileImage statusMessage')
    .populate({
      path: 'targetMessageId',
      populate: [
        { path: 'senderId', select: 'fullName username profileImage' },
        { path: 'chatId', select: 'type memberIds lastMessagePreview' },
      ],
    });

  if (!report) {
    throw new ApiError(404, 'Report not found');
  }

  return report;
}

async function reviewReport(adminUserId, reportId, payload) {
  const report = await Report.findById(reportId);
  if (!report) {
    throw new ApiError(404, 'Report not found');
  }

  report.status = payload.status;
  report.moderationNotes = String(payload.moderationNotes || '').trim();
  report.reviewedByUserId = adminUserId;
  report.reviewedAt = new Date();
  await report.save();

  auditLog('admin.review_report', adminUserId, {
    reportId,
    status: report.status,
  });

  return report;
}

async function setUserStatus(adminUserId, userId, isActive) {
  const update = isActive
    ? { $set: { isActive: true, accountStatus: 'active', lockUntil: null } }
    : { $set: { isActive: false, accountStatus: 'suspended' }, $inc: { sessionVersion: 1 } };
  const user = await User.findByIdAndUpdate(userId, update, { new: true });

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  if (!isActive) {
    await AuthSession.updateMany(
      { userId, revokedAt: null },
      { revokedAt: new Date(), revokeReason: 'admin_suspended' },
    );
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
  getAnalytics,
  listUsers,
  getUserDetails,
  listReports,
  getReportDetails,
  reviewReport,
  setUserStatus,
  deleteMessage,
};
