const Chat = require('../chats/chat.model');
const Message = require('./message.model');
const Reaction = require('./reaction.model');
const Group = require('../groups/group.model');
const GroupMember = require('../groups/groupMember.model');
const ApiError = require('../../utils/ApiError');
const notificationService = require('../notifications/notification.service');
const { getPagination, buildPaginationMeta } = require('../../utils/pagination');
const { getIO } = require('../../sockets/state');
const { ensureChatMember, ensurePrivateMessagingAllowed } = require('../chats/chat.service');

function buildPreview(payload) {
  if (payload.type === 'location') {
    return 'Location';
  }

  if (payload.text?.trim()) {
    return payload.text.slice(0, 120);
  }

  return payload.type || 'Message';
}

function hasMessagePayload(payload) {
  return Boolean(
    payload.text?.trim()
      || payload.mediaUrl
      || (payload.latitude !== undefined && payload.longitude !== undefined),
  );
}

async function assertCanSendToChat(chat, senderId) {
  if (chat.type === 'private') {
    const recipientId = chat.memberIds.find((memberId) => String(memberId) !== String(senderId));
    await ensurePrivateMessagingAllowed(senderId, recipientId);
    return;
  }

  const group = await Group.findOne({ chatId: chat._id });
  if (!group) {
    throw new ApiError(404, 'Group details not found');
  }

  const membership = await GroupMember.findOne({ groupId: group._id, userId: senderId });
  if (!membership) {
    throw new ApiError(403, 'You are not a member of this group');
  }

  if (group.onlyAdminsCanMessage && !['owner', 'admin'].includes(membership.role)) {
    throw new ApiError(403, 'Only admins can send messages in this group');
  }
}

async function populateMessage(messageId) {
  return Message.findById(messageId)
    .populate('senderId', 'fullName username profileImage')
    .populate('replyToMessageId')
    .lean();
}

async function createMessage(senderId, payload) {
  if (!hasMessagePayload(payload)) {
    throw new ApiError(400, 'Message content is required');
  }

  const chat = await ensureChatMember(payload.chatId, senderId);
  await assertCanSendToChat(chat, senderId);

  const recipientIds = chat.memberIds.filter((memberId) => String(memberId) !== String(senderId));
  const message = await Message.create({
    chatId: chat._id,
    senderId,
    type: payload.type || (payload.mediaUrl ? 'file' : 'text'),
    text: payload.text || '',
    mediaUrl: payload.mediaUrl || '',
    thumbnailUrl: payload.thumbnailUrl || '',
    mimeType: payload.mimeType || '',
    fileName: payload.fileName || '',
    fileSize: payload.fileSize || 0,
    duration: payload.duration || 0,
    latitude: payload.latitude ?? null,
    longitude: payload.longitude ?? null,
    replyToMessageId: payload.replyToMessageId || null,
    forwardedFromMessageId: payload.forwardedFromMessageId || null,
    deliveredTo: [],
  });

  chat.lastMessageId = message._id;
  chat.lastMessagePreview = buildPreview(payload);
  chat.lastMessageAt = message.createdAt;
  await chat.save();

  const io = getIO();
  const hydrated = await populateMessage(message._id);

  if (chat.type === 'private') {
    for (const recipientId of recipientIds) {
      await notificationService.createNotification({
        userId: recipientId,
        type: 'private_message',
        title: 'New message',
        body: buildPreview(payload),
        data: {
          chatId: chat._id,
          messageId: message._id,
          senderId,
        },
      });
    }
  } else {
    for (const recipientId of recipientIds) {
      await notificationService.createNotification({
        userId: recipientId,
        type: 'group_message',
        title: 'New group message',
        body: buildPreview(payload),
        data: {
          chatId: chat._id,
          messageId: message._id,
          senderId,
        },
      });
    }
  }

  if (io) {
    io.to(`chat:${chat._id}`).emit('message:new', hydrated);
    for (const memberId of chat.memberIds) {
      io.to(`user:${memberId}`).emit('chat:updated', {
        chatId: chat._id,
        lastMessageId: message._id,
        lastMessagePreview: chat.lastMessagePreview,
        lastMessageAt: chat.lastMessageAt,
      });
    }
  }

  return hydrated;
}

async function listMessages(userId, chatId, query) {
  const chat = await ensureChatMember(chatId, userId);
  const { page, limit, skip } = getPagination(query);
  const participantSettings = chat.participantSettings.find(
    (item) => String(item.userId) === String(userId),
  );

  const criteria = {
    chatId,
    deletedForEveryone: false,
    deletedForUsers: { $ne: userId },
  };

  if (participantSettings?.clearedAt) {
    criteria.createdAt = { $gt: participantSettings.clearedAt };
  }

  const [items, total] = await Promise.all([
    Message.find(criteria)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('senderId', 'fullName username profileImage')
      .populate('replyToMessageId'),
    Message.countDocuments(criteria),
  ]);

  return {
    items,
    meta: buildPaginationMeta({ page, limit, total }),
  };
}

async function getMessageById(userId, messageId) {
  const message = await Message.findById(messageId)
    .populate('senderId', 'fullName username profileImage')
    .populate('replyToMessageId');

  if (!message) {
    throw new ApiError(404, 'Message not found');
  }

  await ensureChatMember(message.chatId, userId);

  if (message.deletedForEveryone || message.deletedForUsers.some((id) => String(id) === String(userId))) {
    throw new ApiError(404, 'Message not found');
  }

  return message;
}

async function editMessage(userId, messageId, text) {
  const message = await Message.findById(messageId);

  if (!message) {
    throw new ApiError(404, 'Message not found');
  }

  await ensureChatMember(message.chatId, userId);

  if (String(message.senderId) !== String(userId)) {
    throw new ApiError(403, 'You can only edit your own messages');
  }

  message.text = text;
  message.editedAt = new Date();
  await message.save();

  const io = getIO();
  if (io) {
    io.to(`chat:${message.chatId}`).emit('message:updated', message);
  }

  return message;
}

async function deleteMessageForEveryone(userId, messageId) {
  const message = await Message.findById(messageId);

  if (!message) {
    throw new ApiError(404, 'Message not found');
  }

  await ensureChatMember(message.chatId, userId);

  if (String(message.senderId) !== String(userId)) {
    throw new ApiError(403, 'You can only delete your own messages for everyone');
  }

  message.deletedForEveryone = true;
  await message.save();

  const io = getIO();
  if (io) {
    io.to(`chat:${message.chatId}`).emit('message:deleted', {
      messageId,
      chatId: message.chatId,
      deletedForEveryone: true,
    });
  }
}

async function deleteMessageForMe(userId, messageId) {
  const message = await Message.findById(messageId);

  if (!message) {
    throw new ApiError(404, 'Message not found');
  }

  await ensureChatMember(message.chatId, userId);

  if (!message.deletedForUsers.some((id) => String(id) === String(userId))) {
    message.deletedForUsers.push(userId);
    await message.save();
  }
}

async function replyToMessage(userId, messageId, payload) {
  await getMessageById(userId, messageId);
  return createMessage(userId, { ...payload, replyToMessageId: messageId });
}

async function forwardMessage(userId, messageId, targetChatId) {
  const originalMessage = await getMessageById(userId, messageId);

  return createMessage(userId, {
    chatId: targetChatId,
    type: originalMessage.type === 'system' ? 'text' : originalMessage.type,
    text: originalMessage.text,
    mediaUrl: originalMessage.mediaUrl,
    thumbnailUrl: originalMessage.thumbnailUrl,
    mimeType: originalMessage.mimeType,
    fileName: originalMessage.fileName,
    fileSize: originalMessage.fileSize,
    duration: originalMessage.duration,
    latitude: originalMessage.latitude,
    longitude: originalMessage.longitude,
    forwardedFromMessageId: messageId,
  });
}

async function addReaction(userId, messageId, emoji) {
  const message = await getMessageById(userId, messageId);
  await Reaction.findOneAndUpdate(
    { messageId, userId },
    { emoji },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const reactions = await Reaction.find({ messageId: message._id });
  return reactions;
}

async function removeReaction(userId, messageId) {
  await getMessageById(userId, messageId);
  await Reaction.findOneAndDelete({ messageId, userId });
  return Reaction.find({ messageId });
}

async function markDelivered(userId, messageId) {
  const message = await getMessageById(userId, messageId);

  if (!message.deliveredTo.some((id) => String(id) === String(userId))) {
    message.deliveredTo.push(userId);
    await message.save();
  }

  return message;
}

async function markSeen(userId, messageId) {
  const message = await getMessageById(userId, messageId);
  const alreadySeen = message.seenBy.some((item) => String(item.userId) === String(userId));

  if (!alreadySeen) {
    message.seenBy.push({
      userId,
      seenAt: new Date(),
    });
    await message.save();
  }

  const io = getIO();
  if (io) {
    io.to(`chat:${message.chatId}`).emit('message:seen', {
      chatId: message.chatId,
      messageId: message._id,
      userId,
    });
  }

  return message;
}

module.exports = {
  createMessage,
  listMessages,
  getMessageById,
  editMessage,
  deleteMessageForEveryone,
  deleteMessageForMe,
  replyToMessage,
  forwardMessage,
  addReaction,
  removeReaction,
  markSeen,
  markDelivered,
};
