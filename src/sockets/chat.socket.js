const messageService = require('../modules/messages/message.service');
const { ensureChatMember } = require('../modules/chats/chat.service');
const { canEmitTyping } = require('./presence.socket');

async function joinChatRoom(socket, chatId) {
  const chat = await ensureChatMember(chatId, socket.user._id);
  socket.join(`chat:${chat._id}`);
  return chat;
}

async function safeSocketHandler(socket, callback, responder) {
  try {
    const result = await callback();
    if (responder) {
      responder({ success: true, data: result });
    }
  } catch (error) {
    if (responder) {
      responder({ success: false, message: error.message });
      return;
    }

    socket.emit('socket:error', {
      message: error.message || 'Socket action failed',
    });
  }
}

function registerChatSocket(io, socket) {
  socket.on('chat:join', ({ chatId } = {}, callback) => safeSocketHandler(
    socket,
    async () => {
      await joinChatRoom(socket, chatId);
      return { chatId };
    },
    callback,
  ));

  socket.on('chat:leave', ({ chatId } = {}, callback) => safeSocketHandler(
    socket,
    async () => {
      await ensureChatMember(chatId, socket.user._id);
      socket.leave(`chat:${chatId}`);
      return { chatId };
    },
    callback,
  ));

  socket.on('group:join', ({ chatId } = {}, callback) => safeSocketHandler(
    socket,
    async () => {
      await joinChatRoom(socket, chatId);
      return { chatId };
    },
    callback,
  ));

  socket.on('group:leave', ({ chatId } = {}, callback) => safeSocketHandler(
    socket,
    async () => {
      await ensureChatMember(chatId, socket.user._id);
      socket.leave(`chat:${chatId}`);
      return { chatId };
    },
    callback,
  ));

  socket.on('message:typing', ({ chatId } = {}) => safeSocketHandler(socket, async () => {
    await ensureChatMember(chatId, socket.user._id);
    if (!(await canEmitTyping(socket.user._id))) {
      return;
    }
    socket.to(`chat:${chatId}`).emit('message:typing', {
      chatId,
      userId: socket.user._id,
      fullName: socket.user.fullName,
    });
  }));

  socket.on('message:stop-typing', ({ chatId } = {}) => safeSocketHandler(socket, async () => {
    await ensureChatMember(chatId, socket.user._id);
    socket.to(`chat:${chatId}`).emit('message:stop-typing', {
      chatId,
      userId: socket.user._id,
    });
  }));

  socket.on('message:seen', ({ messageId } = {}, callback) => safeSocketHandler(
    socket,
    () => messageService.markSeen(socket.user._id, messageId),
    callback,
  ));

  socket.on('message:delivered', ({ messageId } = {}, callback) => safeSocketHandler(
    socket,
    () => messageService.markDelivered(socket.user._id, messageId),
    callback,
  ));

  socket.on('message:send', (payload, callback) => safeSocketHandler(
    socket,
    () => messageService.createMessage(socket.user._id, payload),
    callback,
  ));
}

module.exports = {
  registerChatSocket,
};
