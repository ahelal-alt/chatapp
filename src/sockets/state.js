let ioInstance = null;
const activeSocketsByUser = new Map();

function setIO(io) {
  ioInstance = io;
}

function getIO() {
  return ioInstance;
}

function addUserSocket(userId, socketId) {
  const key = String(userId);
  const sockets = activeSocketsByUser.get(key) || new Set();
  sockets.add(socketId);
  activeSocketsByUser.set(key, sockets);
  return sockets.size;
}

function removeUserSocket(userId, socketId) {
  const key = String(userId);
  const sockets = activeSocketsByUser.get(key);

  if (!sockets) {
    return 0;
  }

  sockets.delete(socketId);

  if (!sockets.size) {
    activeSocketsByUser.delete(key);
    return 0;
  }

  activeSocketsByUser.set(key, sockets);
  return sockets.size;
}

function getUserSocketCount(userId) {
  return activeSocketsByUser.get(String(userId))?.size || 0;
}

module.exports = {
  setIO,
  getIO,
  addUserSocket,
  removeUserSocket,
  getUserSocketCount,
};
