const Chat = require('./chat.model');
const Message = require('../messages/message.model');
const ApiError = require('../../utils/ApiError');
const { getPagination, buildPaginationMeta } = require('../../utils/pagination');
const { getIO } = require('../../sockets/state');
const { ensurePrivateMessagingAllowed } = require('../../utils/privacy');

function buildMemberHash(userIdA, userIdB) {
  return [String(userIdA), String(userIdB)].sort().join(':');
}

function ensureParticipantSetting(chat, userId) {
  let setting = chat.participantSettings.find(
    (item) => String(item.userId) === String(userId),
  );

  if (!setting) {
    setting = {
      userId,
      archivedAt: null,
      mutedUntil: null,
      pinnedAt: null,
      clearedAt: null,
    };
    chat.participantSettings.push(setting);
  }

  return setting;
}

function buildChatPreview(message) {
  if (!message) {
    return '';
  }

  if (message.deletedForEveryone) {
    return '';
  }

  if (message.type === 'location') {
    return 'Location';
  }

  if (message.text?.trim()) {
    return message.text.slice(0, 120);
  }

  return message.type || 'Message';
}

async function emitChatUpdated(chat) {
  const io = getIO();

  if (!io || !chat) {
    return;
  }

  for (const memberId of chat.memberIds) {
    const participantSetting = ensureParticipantSetting(chat, memberId);
    const unreadCount = await getUnreadCount(chat._id, memberId, participantSetting.clearedAt);

    io.to(`user:${memberId}`).emit('chat:updated', {
      chatId: chat._id,
      lastMessageId: chat.lastMessageId,
      lastMessagePreview: chat.lastMessagePreview,
      lastMessageAt: chat.lastMessageAt,
      unreadCount,
    });
  }
}

async function refreshChatSummary(chatId) {
  const chat = await Chat.findById(chatId);

  if (!chat) {
    return null;
  }

  const latestMessage = await Message.findOne({
    chatId,
    deletedForEveryone: false,
  }).sort({ createdAt: -1 });

  chat.lastMessageId = latestMessage?._id || null;
  chat.lastMessagePreview = buildChatPreview(latestMessage);
  chat.lastMessageAt = latestMessage?.createdAt || null;
  await chat.save();

  await emitChatUpdated(chat);
  return chat;
}

async function openPrivateChat(userId, otherUserId) {
  if (String(userId) === String(otherUserId)) {
    throw new ApiError(400, 'You cannot create a private chat with yourself');
  }

  await ensurePrivateMessagingAllowed(userId, otherUserId);

  const memberHash = buildMemberHash(userId, otherUserId);
  let chat = await Chat.findOne({ type: 'private', memberHash });

  if (!chat) {
    chat = await Chat.create({
      type: 'private',
      memberIds: [userId, otherUserId],
      memberHash,
      createdBy: userId,
      participantSettings: [{ userId }, { userId: otherUserId }],
    });
  }

  return chat;
}

async function ensureChatMember(chatId, userId) {
  const chat = await Chat.findById(chatId);

  if (!chat) {
    throw new ApiError(404, 'Chat not found');
  }

  const isMember = chat.memberIds.some((memberId) => String(memberId) === String(userId));
  if (!isMember) {
    throw new ApiError(403, 'You are not a member of this chat');
  }

  return chat;
}

async function getUnreadCount(chatId, userId, clearedAt) {
  const criteria = {
    chatId,
    senderId: { $ne: userId },
    deletedForEveryone: false,
    deletedForUsers: { $ne: userId },
    readByUserIds: { $ne: userId },
    'seenBy.userId': { $ne: userId },
  };

  if (clearedAt) {
    criteria.createdAt = { $gt: clearedAt };
  }

  return Message.countDocuments(criteria);
}

async function listChats(userId, query) {
  const { page, limit, skip } = getPagination(query);
  const criteria = { memberIds: userId };

  const [items, total] = await Promise.all([
    Chat.find(criteria)
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('lastMessageId')
      .populate('memberIds', 'fullName username profileImage isOnline lastSeen'),
    Chat.countDocuments(criteria),
  ]);

  const enriched = [];
  for (const chat of items) {
    const setting = ensureParticipantSetting(chat, userId);
    const unreadCount = await getUnreadCount(chat._id, userId, setting.clearedAt);
    enriched.push({
      ...chat.toObject(),
      unreadCount,
      participantSettings: setting,
    });
  }

  return {
    items: enriched,
    meta: buildPaginationMeta({ page, limit, total }),
  };
}

async function getChatDetails(userId, chatId) {
  const chat = await ensureChatMember(chatId, userId);
  return chat.populate('memberIds', 'fullName username profileImage isOnline lastSeen');
}

async function setChatFlag(userId, chatId, updates) {
  const chat = await ensureChatMember(chatId, userId);
  const setting = ensureParticipantSetting(chat, userId);

  Object.assign(setting, updates);
  await chat.save();

  return chat;
}

async function clearChat(userId, chatId) {
  const chat = await ensureChatMember(chatId, userId);
  const setting = ensureParticipantSetting(chat, userId);
  setting.clearedAt = new Date();
  await chat.save();
}

module.exports = {
  buildMemberHash,
  buildChatPreview,
  emitChatUpdated,
  refreshChatSummary,
  ensurePrivateMessagingAllowed,
  openPrivateChat,
  ensureChatMember,
  listChats,
  getChatDetails,
  setChatFlag,
  clearChat,
};
