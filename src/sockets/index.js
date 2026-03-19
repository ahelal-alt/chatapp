const User = require('../modules/users/user.model');
const ApiError = require('../utils/ApiError');
const { verifyAccessToken } = require('../utils/token');
const notificationService = require('../modules/notifications/notification.service');
const { registerPresenceSocket, setPresence } = require('./presence.socket');
const { registerChatSocket } = require('./chat.socket');
const { registerNotificationSocket } = require('./notification.socket');
const { addUserSocket, removeUserSocket } = require('./state');

async function authenticateSocket(socket, next) {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return next(new ApiError(401, 'Authentication required'));
    }

    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);

    if (!user || !user.isActive) {
      return next(new ApiError(401, 'Invalid authentication token'));
    }

    socket.user = user;
    return next();
  } catch (error) {
    return next(new ApiError(401, 'Invalid authentication token'));
  }
}

function registerSocketHandlers(io) {
  io.on('connection', async (socket) => {
    socket.join(`user:${socket.user._id}`);
    addUserSocket(socket.user._id, socket.id);

    socket.emit('connection:init', {
      userId: socket.user._id,
      role: socket.user.role,
    });

    await Promise.all([
      setPresence(io, socket.user._id, true),
      notificationService.emitUnreadCount(socket.user._id),
    ]);

    registerPresenceSocket(io, socket);
    registerChatSocket(io, socket);
    registerNotificationSocket(io, socket);

    socket.on('disconnect', async () => {
      const remainingSockets = removeUserSocket(socket.user._id, socket.id);

      if (!remainingSockets) {
        await setPresence(io, socket.user._id, false);
      }
    });
  });
}

module.exports = {
  authenticateSocket,
  registerSocketHandlers,
};
