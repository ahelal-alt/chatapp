const Notification = require('./notification.model');
const ApiError = require('../../utils/ApiError');
const { getPagination, buildPaginationMeta } = require('../../utils/pagination');
const { getIO } = require('../../sockets/state');

async function createNotification(payload) {
  const notification = await Notification.create(payload);
  const io = getIO();

  if (io) {
    io.to(`user:${payload.userId}`).emit('notification:new', notification);
  }

  return notification;
}

async function listNotifications(userId, query) {
  const { page, limit, skip } = getPagination(query);

  const [items, total] = await Promise.all([
    Notification.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Notification.countDocuments({ userId }),
  ]);

  return {
    items,
    meta: buildPaginationMeta({ page, limit, total }),
  };
}

async function markRead(userId, notificationId) {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, userId },
    { isRead: true },
    { new: true },
  );

  if (!notification) {
    throw new ApiError(404, 'Notification not found');
  }

  const io = getIO();
  if (io) {
    io.to(`user:${userId}`).emit('notification:read', { notificationId });
  }

  return notification;
}

async function markAllRead(userId) {
  await Notification.updateMany({ userId, isRead: false }, { isRead: true });

  const io = getIO();
  if (io) {
    io.to(`user:${userId}`).emit('notification:read', { all: true });
  }
}

module.exports = {
  createNotification,
  listNotifications,
  markRead,
  markAllRead,
};
