const User = require('../modules/users/user.model');
const { getUserSocketCount } = require('./state');

function buildPresencePayload(userId, isOnline, lastSeen = null) {
  return {
    userId,
    isOnline,
    lastSeen,
  };
}

function emitPresence(io, userId, isOnline, lastSeen = null) {
  io.emit('presence:update', buildPresencePayload(userId, isOnline, lastSeen));
}

async function setPresence(io, userId, isOnline) {
  const lastSeen = isOnline ? null : new Date();

  await User.findByIdAndUpdate(userId, {
    isOnline,
    lastSeen,
  });

  emitPresence(io, userId, isOnline, lastSeen);
}

function registerPresenceSocket(io, socket) {
  socket.on('presence:online', async () => {
    await setPresence(io, socket.user._id, true);
  });

  socket.on('presence:offline', async () => {
    if (getUserSocketCount(socket.user._id) > 1) {
      return;
    }

    await setPresence(io, socket.user._id, false);
  });
}

module.exports = {
  buildPresencePayload,
  emitPresence,
  setPresence,
  registerPresenceSocket,
};
