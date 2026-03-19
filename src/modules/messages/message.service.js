const Message = require('./message.model');
const Reaction = require('./reaction.model');
const Chat = require('../chats/chat.model');
const Group = require('../groups/group.model');
const GroupMember = require('../groups/groupMember.model');
const ApiError = require('../../utils/ApiError');
const notificationService = require('../notifications/notification.service');
const { getPagination, buildPaginationMeta } = require('../../utils/pagination');
const { escapeRegex } = require('../../utils/validation');
const { getIO } = require('../../sockets/state');
const { getMessagingPrivacySettings } = require('../../utils/privacy');
const {
  ensureChatMember,
  ensurePrivateMessagingAllowed,
  buildChatPreview,
  emitChatUpdated,
  refreshChatSummary,
} = require('../chats/chat.service');

function hasMessagePayload(payload) {
  return Boolean(
    payload.text?.trim()
      || payload.ciphertext
      || payload.mediaUrl
      || (payload.latitude !== undefined && payload.longitude !== undefined),
  );
}

function buildMediaKind(message) {
  if (message.type === 'image' || message.mimeType?.startsWith('image/')) {
    return 'image';
  }
  if (message.type === 'video' || message.mimeType?.startsWith('video/')) {
    return 'video';
  }
  if (message.type === 'voice' || message.type === 'audio' || message.mimeType?.startsWith('audio/')) {
    return 'audio';
  }
  if (message.mimeType === 'application/pdf'
    || message.mimeType?.includes('document')
    || message.mimeType?.includes('sheet')
    || message.mimeType?.includes('presentation')
    || message.mimeType?.startsWith('text/')) {
    return 'document';
  }

  return 'other';
}

async function assertCanSendToChat(chat, senderId) {
  if (chat.type === 'private') {
    const recipientId = chat.memberIds.find((memberId) => String(memberId) !== String(senderId));
    await ensurePrivateMessagingAllowed(senderId, recipientId);
    return null;
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

  return { group, membership };
}

async function assertCanPinInChat(chat, userId) {
  if (chat.type === 'private') {
    return;
  }

  const group = await Group.findOne({ chatId: chat._id });
  if (!group) {
    throw new ApiError(404, 'Group details not found');
  }

  const membership = await GroupMember.findOne({ groupId: group._id, userId });
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    throw new ApiError(403, 'Only group admins can pin messages');
  }
}

async function populateMessage(messageId) {
  return Message.findById(messageId)
    .populate('senderId', 'fullName username profileImage')
    .populate('replyToMessageId')
    .populate('pinnedBy', 'fullName username')
    .lean();
}

async function createMessage(senderId, payload) {
  if (!hasMessagePayload(payload)) {
    throw new ApiError(400, 'Message content is required');
  }

  const chat = await ensureChatMember(payload.chatId, senderId);
  await assertCanSendToChat(chat, senderId);

  if (payload.clientMessageId) {
    const existing = await Message.findOne({
      senderId,
      chatId: chat._id,
      clientMessageId: payload.clientMessageId,
    });

    if (existing) {
      return populateMessage(existing._id);
    }
  }

  const recipientIds = chat.memberIds.filter((memberId) => String(memberId) !== String(senderId));
  const isEncrypted = Boolean(payload.isEncrypted);

  if (isEncrypted) {
    if (chat.type !== 'private') {
      throw new ApiError(400, 'End-to-end encryption is currently available only for private chats');
    }

    if (!payload.ciphertext || !payload.ciphertextIv || !Array.isArray(payload.encryptedKeys) || !payload.encryptedKeys.length) {
      throw new ApiError(400, 'Encrypted messages require ciphertext, iv, and encryptedKeys');
    }

    if (String(payload.text || '').trim()) {
      throw new ApiError(400, 'Encrypted messages must not include plaintext text');
    }

    if (payload.mediaUrl || (payload.type && payload.type !== 'text')) {
      throw new ApiError(400, 'Encrypted private chats currently support secure text messages only');
    }
  }

  const message = await Message.create({
    chatId: chat._id,
    senderId,
    clientMessageId: payload.clientMessageId || '',
    type: payload.type || (payload.mediaUrl ? 'file' : 'text'),
    text: isEncrypted ? '' : (payload.text || ''),
    mediaUrl: payload.mediaUrl || '',
    thumbnailUrl: payload.thumbnailUrl || '',
    mimeType: payload.mimeType || '',
    fileName: payload.fileName || '',
    fileSize: payload.fileSize || 0,
    duration: payload.duration || 0,
    isEncrypted,
    ciphertext: payload.ciphertext || '',
    ciphertextIv: payload.ciphertextIv || '',
    encryptionVersion: payload.encryptionVersion || 0,
    encryptedKeys: payload.encryptedKeys || [],
    latitude: payload.latitude ?? null,
    longitude: payload.longitude ?? null,
    replyToMessageId: payload.replyToMessageId || null,
    forwardedFromMessageId: payload.forwardedFromMessageId || null,
    deliveredTo: [],
    readByUserIds: [senderId],
  });

  chat.lastMessageId = message._id;
  chat.lastMessagePreview = buildChatPreview(message);
  chat.lastMessageAt = message.createdAt;
  await chat.save();

  const io = getIO();
  const hydrated = await populateMessage(message._id);

  for (const recipientId of recipientIds) {
    await notificationService.createNotification({
      userId: recipientId,
      type: chat.type === 'private' ? 'private_message' : 'group_message',
      title: chat.type === 'private' ? 'New message' : 'New group message',
      body: message.isEncrypted && chat.type === 'private' ? 'Encrypted message' : buildChatPreview(message),
      data: {
        chatId: chat._id,
        messageId: message._id,
        senderId,
      },
    });
  }

  if (io) {
    io.to(`chat:${chat._id}`).emit('message:new', hydrated);
  }

  await emitChatUpdated(chat);

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
      .populate('replyToMessageId')
      .populate('pinnedBy', 'fullName username'),
    Message.countDocuments(criteria),
  ]);

  return {
    items,
    meta: buildPaginationMeta({ page, limit, total }),
  };
}

async function searchMessages(userId, chatId, query) {
  const chat = await ensureChatMember(chatId, userId);
  const { page, limit, skip } = getPagination(query);
  const participantSettings = chat.participantSettings.find(
    (item) => String(item.userId) === String(userId),
  );
  const pattern = escapeRegex(String(query.q || '').trim());

  const criteria = {
    chatId,
    deletedForEveryone: false,
    deletedForUsers: { $ne: userId },
    text: { $regex: pattern, $options: 'i' },
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
      .populate('replyToMessageId')
      .populate('pinnedBy', 'fullName username'),
    Message.countDocuments(criteria),
  ]);

  return {
    items,
    meta: buildPaginationMeta({ page, limit, total }),
  };
}

async function listPinnedMessages(userId, chatId, query) {
  await ensureChatMember(chatId, userId);
  const { page, limit, skip } = getPagination(query);
  const criteria = {
    chatId,
    deletedForEveryone: false,
    deletedForUsers: { $ne: userId },
    pinnedAt: { $ne: null },
  };

  const [items, total] = await Promise.all([
    Message.find(criteria)
      .sort({ pinnedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('senderId', 'fullName username profileImage')
      .populate('replyToMessageId')
      .populate('pinnedBy', 'fullName username'),
    Message.countDocuments(criteria),
  ]);

  return {
    items,
    meta: buildPaginationMeta({ page, limit, total }),
  };
}

async function listSharedFiles(userId, query) {
  const { page, limit, skip } = getPagination(query);
  const availableChats = await Chat.find({ memberIds: userId }).select('_id').lean();
  const allowedChatIds = availableChats.map((chat) => chat._id);

  if (!allowedChatIds.length) {
    return {
      items: [],
      meta: buildPaginationMeta({ page, limit, total: 0 }),
    };
  }

  const criteria = {
    chatId: { $in: allowedChatIds },
    deletedForEveryone: false,
    deletedForUsers: { $ne: userId },
    mediaUrl: { $nin: ['', null] },
    type: { $in: ['image', 'video', 'audio', 'file', 'voice'] },
  };

  if (query.chatId) {
    await ensureChatMember(query.chatId, userId);
    criteria.chatId = query.chatId;
  }

  if (query.senderId) {
    criteria.senderId = query.senderId;
  }

  if (query.kind && query.kind !== 'all') {
    if (query.kind === 'document') {
      criteria.$or = [
        { mimeType: /application\/pdf/i },
        { mimeType: /document/i },
        { mimeType: /sheet/i },
        { mimeType: /presentation/i },
        { mimeType: /text\//i },
      ];
    } else if (query.kind === 'other') {
      criteria.$nor = [
        { type: 'image' },
        { type: 'video' },
        { type: 'audio' },
        { type: 'voice' },
        { mimeType: /^image\//i },
        { mimeType: /^video\//i },
        { mimeType: /^audio\//i },
        { mimeType: /application\/pdf/i },
        { mimeType: /document/i },
        { mimeType: /sheet/i },
        { mimeType: /presentation/i },
        { mimeType: /text\//i },
      ];
    } else if (query.kind === 'audio') {
      criteria.$or = [
        { type: 'audio' },
        { type: 'voice' },
        { mimeType: /^audio\//i },
      ];
    } else {
      criteria.$or = [
        { type: query.kind },
        { mimeType: new RegExp(`^${escapeRegex(query.kind)}/`, 'i') },
      ];
    }
  }

  if (query.q) {
    criteria.fileName = { $regex: escapeRegex(String(query.q).trim()), $options: 'i' };
  }

  if (query.from || query.to) {
    criteria.createdAt = {};
    if (query.from) {
      criteria.createdAt.$gte = new Date(query.from);
    }
    if (query.to) {
      criteria.createdAt.$lte = new Date(query.to);
    }
  }

  const [items, total] = await Promise.all([
    Message.find(criteria)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('senderId', 'fullName username profileImage'),
    Message.countDocuments(criteria),
  ]);

  return {
    items: items.map((item) => ({
      ...item.toObject(),
      mediaKind: buildMediaKind(item),
    })),
    meta: buildPaginationMeta({ page, limit, total }),
  };
}

async function getMessageById(userId, messageId) {
  const message = await Message.findById(messageId)
    .populate('senderId', 'fullName username profileImage')
    .populate('replyToMessageId')
    .populate('pinnedBy', 'fullName username');

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

  if (message.deletedForEveryone || message.deletedForUsers.some((id) => String(id) === String(userId))) {
    throw new ApiError(404, 'Message not found');
  }

  if (String(message.senderId) !== String(userId)) {
    throw new ApiError(403, 'You can only edit your own messages');
  }

  message.text = text;
  message.editedAt = new Date();
  await message.save();

  const io = getIO();
  if (io) {
    io.to(`chat:${message.chatId}`).emit('message:updated', await populateMessage(message._id));
  }

  await refreshChatSummary(message.chatId);
  return populateMessage(message._id);
}

async function pinMessage(userId, messageId) {
  const message = await Message.findById(messageId);

  if (!message || message.deletedForEveryone) {
    throw new ApiError(404, 'Message not found');
  }

  const chat = await ensureChatMember(message.chatId, userId);
  await assertCanPinInChat(chat, userId);

  message.pinnedAt = new Date();
  message.pinnedBy = userId;
  await message.save();

  const hydrated = await populateMessage(message._id);
  const io = getIO();
  if (io) {
    io.to(`chat:${message.chatId}`).emit('message:pinned', hydrated);
  }

  return hydrated;
}

async function unpinMessage(userId, messageId) {
  const message = await Message.findById(messageId);

  if (!message || message.deletedForEveryone) {
    throw new ApiError(404, 'Message not found');
  }

  const chat = await ensureChatMember(message.chatId, userId);
  await assertCanPinInChat(chat, userId);

  message.pinnedAt = null;
  message.pinnedBy = null;
  await message.save();

  const hydrated = await populateMessage(message._id);
  const io = getIO();
  if (io) {
    io.to(`chat:${message.chatId}`).emit('message:unpinned', {
      chatId: message.chatId,
      messageId: message._id,
    });
  }

  return hydrated;
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
  message.pinnedAt = null;
  message.pinnedBy = null;
  await message.save();
  await refreshChatSummary(message.chatId);

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
  const io = getIO();

  if (io) {
    io.to(`chat:${message.chatId}`).emit('message:reactions', {
      chatId: message.chatId,
      messageId: message._id,
      reactions,
    });
  }

  return reactions;
}

async function removeReaction(userId, messageId) {
  const message = await getMessageById(userId, messageId);
  await Reaction.findOneAndDelete({ messageId, userId });
  const reactions = await Reaction.find({ messageId });
  const io = getIO();

  if (io) {
    io.to(`chat:${message.chatId}`).emit('message:reactions', {
      chatId: message.chatId,
      messageId: message._id,
      reactions,
    });
  }

  return reactions;
}

async function markDelivered(userId, messageId) {
  const message = await getMessageById(userId, messageId);

  if (!message.deliveredTo.some((id) => String(id) === String(userId))) {
    message.deliveredTo.push(userId);
    await message.save();
  }

  const io = getIO();
  if (io) {
    io.to(`chat:${message.chatId}`).emit('message:delivered', {
      chatId: message.chatId,
      messageId: message._id,
      userId,
    });
  }

  return message;
}

async function markSeen(userId, messageId) {
  const message = await getMessageById(userId, messageId);
  const { readReceiptsEnabled } = await getMessagingPrivacySettings(userId);
  const alreadyRead = message.readByUserIds.some((id) => String(id) === String(userId));
  const alreadySeen = message.seenBy.some((item) => String(item.userId) === String(userId));

  if (!alreadyRead) {
    message.readByUserIds.push(userId);
  }

  if (readReceiptsEnabled && !alreadySeen) {
    message.seenBy.push({
      userId,
      seenAt: new Date(),
    });
  }

  if (!alreadyRead || (readReceiptsEnabled && !alreadySeen)) {
    await message.save();
  }

  const io = getIO();
  if (io && readReceiptsEnabled) {
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
  searchMessages,
  listPinnedMessages,
  listSharedFiles,
  getMessageById,
  editMessage,
  pinMessage,
  unpinMessage,
  deleteMessageForEveryone,
  deleteMessageForMe,
  replyToMessage,
  forwardMessage,
  addReaction,
  removeReaction,
  markSeen,
  markDelivered,
};
