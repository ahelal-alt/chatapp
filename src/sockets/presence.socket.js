const User = require('../modules/users/user.model');

function emitPresence(io, userId, isOnline) {
  io.emit('presence:update', {
    userId,
    isOnline,
    lastSeen: isOnline ? null : new Date(),
  });
}

async function setPresence(io, userId, isOnline) {
  await User.findByIdAndUpdate(userId, {
    isOnline,
    lastSeen: isOnline ? null : new Date(),
  });

  emitPresence(io, userId, isOnline);
}

function registerPresenceSocket(io, socket) {
  socket.on('presence:online', async () => {
    await setPresence(io, socket.user._id, true);
  });

  socket.on('presence:offline', async () => {
    await setPresence(io, socket.user._id, false);
  });

  socket.on('disconnect', async () => {
    await setPresence(io, socket.user._id, false);
  });
}

module.exports = {
  registerPresenceSocket,
};

