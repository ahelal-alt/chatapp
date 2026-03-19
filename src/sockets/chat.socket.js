const messageService = require('../modules/messages/message.service');

function registerChatSocket(io, socket) {
  socket.on('chat:join', async ({ chatId }) => {
    socket.join(`chat:${chatId}`);
  });

  socket.on('chat:leave', async ({ chatId }) => {
    socket.leave(`chat:${chatId}`);
  });

  socket.on('group:join', async ({ chatId }) => {
    socket.join(`chat:${chatId}`);
  });

  socket.on('group:leave', async ({ chatId }) => {
    socket.leave(`chat:${chatId}`);
  });

  socket.on('message:typing', ({ chatId }) => {
    socket.to(`chat:${chatId}`).emit('message:typing', {
      chatId,
      userId: socket.user._id,
    });
  });

  socket.on('message:stop-typing', ({ chatId }) => {
    socket.to(`chat:${chatId}`).emit('message:stop-typing', {
      chatId,
      userId: socket.user._id,
    });
  });

  socket.on('message:seen', async ({ messageId }) => {
    await messageService.markSeen(socket.user._id, messageId);
  });

  socket.on('message:send', async (payload, callback) => {
    try {
      const message = await messageService.createMessage(socket.user._id, payload);
      if (callback) {
        callback({ success: true, data: message });
      }
    } catch (error) {
      if (callback) {
        callback({ success: false, message: error.message });
      }
    }
  });
}

module.exports = {
  registerChatSocket,
};

