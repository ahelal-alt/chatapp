const User = require('../users/user.model');
const Chat = require('../chats/chat.model');
const Group = require('../groups/group.model');
const Message = require('../messages/message.model');
const { buildPublicProfile } = require('../users/user.service');
const { escapeRegex } = require('../../utils/validation');

async function searchWorkspace(userId, query) {
  const limit = Number(query.limit || 5);
  const regex = new RegExp(escapeRegex(String(query.q || '').trim()), 'i');

  const memberChats = await Chat.find({ memberIds: userId })
    .select('_id type memberIds lastMessagePreview lastMessageAt')
    .sort({ lastMessageAt: -1 })
    .lean();
  const accessibleChatIds = memberChats.map((chat) => chat._id);
  const groupChatIds = memberChats.filter((chat) => chat.type === 'group').map((chat) => chat._id);

  const [userDocs, groupDocs, messageDocs, fileDocs] = await Promise.all([
    User.find({
      _id: { $ne: userId },
      isActive: true,
      accountStatus: { $ne: 'deleted' },
      $or: [{ username: regex }, { fullName: regex }],
    })
      .sort({ username: 1 })
      .limit(limit),
    Group.find({
      chatId: { $in: groupChatIds },
      $or: [{ name: regex }, { description: regex }],
    })
      .limit(limit)
      .lean(),
    Message.find({
      chatId: { $in: accessibleChatIds },
      deletedForEveryone: false,
      $or: [{ text: regex }, { fileName: regex }],
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('chatId senderId text fileName type mediaUrl createdAt isEncrypted'),
    Message.find({
      chatId: { $in: accessibleChatIds },
      deletedForEveryone: false,
      mediaUrl: { $ne: '' },
      $or: [{ fileName: regex }, { mimeType: regex }, { text: regex }],
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('chatId senderId type fileName mediaUrl mimeType fileSize duration createdAt'),
  ]);

  const users = [];
  for (const user of userDocs) {
    users.push(await buildPublicProfile(userId, user));
  }

  const chats = memberChats
    .filter((chat) => regex.test(chat.lastMessagePreview || ''))
    .slice(0, limit)
    .map((chat) => ({
      id: chat._id,
      type: chat.type,
      lastMessagePreview: chat.lastMessagePreview,
      lastMessageAt: chat.lastMessageAt,
    }));

  const groups = groupDocs.map((group) => ({
    id: group._id,
    chatId: group.chatId,
    name: group.name,
    description: group.description,
    image: group.image,
  }));

  return {
    users,
    chats,
    groups,
    messages: messageDocs,
    files: fileDocs,
  };
}

module.exports = {
  searchWorkspace,
};
