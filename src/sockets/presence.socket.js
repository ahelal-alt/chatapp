const User = require('../modules/users/user.model');
const { buildPresencePayloadForViewer, getMessagingPrivacySettings } = require('../utils/privacy');
const { getConnectedUserIds, getUserSocketCount } = require('./state');

async function emitPresence(io, userId, isOnline, lastSeen = null) {
  const connectedUserIds = getConnectedUserIds();

  await Promise.all(
    connectedUserIds.map(async (viewerId) => {
      const payload = await buildPresencePayloadForViewer(viewerId, userId, isOnline, lastSeen);
      io.to(`user:${viewerId}`).emit('presence:update', payload);
    }),
  );
}

async function setPresence(io, userId, isOnline) {
  const lastSeen = isOnline ? null : new Date();

  await User.findByIdAndUpdate(userId, {
    isOnline,
    lastSeen,
  });

  await emitPresence(io, userId, isOnline, lastSeen);
}

async function canEmitTyping(userId) {
  const settings = await getMessagingPrivacySettings(userId);
  return settings.typingIndicatorEnabled;
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
  emitPresence,
  setPresence,
  canEmitTyping,
  registerPresenceSocket,
};
