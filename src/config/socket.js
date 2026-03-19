const { Server } = require('socket.io');
const env = require('./env');
const { authenticateSocket, registerSocketHandlers } = require('../sockets');
const { setIO, getIO } = require('../sockets/state');

function initializeSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: env.clientUrl,
      credentials: true,
    },
  });

  io.use(authenticateSocket);
  registerSocketHandlers(io);
  setIO(io);

  return io;
}

module.exports = {
  initializeSocket,
  getIO,
};
