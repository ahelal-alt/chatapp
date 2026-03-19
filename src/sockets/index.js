const User = require('../modules/users/user.model');
const ApiError = require('../utils/ApiError');
const { verifyAccessToken } = require('../utils/token');
const { registerPresenceSocket } = require('./presence.socket');
const { registerChatSocket } = require('./chat.socket');
const { registerNotificationSocket } = require('./notification.socket');

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
    socket.emit('connection:init', {
      userId: socket.user._id,
    });

    await User.findByIdAndUpdate(socket.user._id, { isOnline: true, lastSeen: null });
    io.emit('presence:update', {
      userId: socket.user._id,
      isOnline: true,
      lastSeen: null,
    });

    registerPresenceSocket(io, socket);
    registerChatSocket(io, socket);
    registerNotificationSocket(io, socket);
  });
}

module.exports = {
  authenticateSocket,
  registerSocketHandlers,
};
