const notificationService = require('../modules/notifications/notification.service');

function registerNotificationSocket(io, socket) {
  socket.on('notification:read', async ({ notificationId }) => {
    await notificationService.markRead(socket.user._id, notificationId);
  });
}

module.exports = {
  registerNotificationSocket,
};

