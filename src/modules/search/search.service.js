const User = require('../users/user.model');
const Chat = require('../chats/chat.model');
const Group = require('../groups/group.model');
const Message = require('../messages/message.model');
const Notification = require('../notifications/notification.model');
const Report = require('../reports/report.model');
const ContactRequest = require('../contacts/contactRequest.model');
const userService = require('../users/user.service');
const { escapeRegex } = require('../../utils/validation');
const { normalizeMediaMetadata } = require('../../utils/media');

function normalizeQuery(value) {
  return String(value || '').trim();
}

function toId(value) {
  return String(value?._id || value || '');
}

function safeLower(value) {
  return String(value || '').toLowerCase();
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function buildRouteHint(section, params = {}) {
  return { section, params };
}

function buildChatDisplay(chat, viewerId, groupByChatId) {
  if (chat.type === 'group') {
    const group = groupByChatId.get(String(chat._id));
    return {
      title: group?.name || 'Group chat',
      subtitle: group?.description || `${chat.memberIds?.length || 0} members`,
      image: group?.image || '',
      matchedFieldsBase: ['groupName', 'groupDescription'],
    };
  }

  const others = (chat.memberIds || []).filter((member) => String(member._id || member) !== String(viewerId));
  const names = others.map((member) => member.fullName).filter(Boolean);
  const usernames = others.map((member) => member.username).filter(Boolean);

  return {
    title: names.join(', ') || usernames.map((username) => `@${username}`).join(', ') || 'Direct message',
    subtitle: usernames.length ? usernames.map((username) => `@${username}`).join(', ') : 'Private chat',
    image: others[0]?.profileImage || '',
    matchedFieldsBase: ['participantName', 'participantUsername'],
  };
}

function scoreTextMatch(query, rawFields) {
  const q = safeLower(query);
  let score = 0;
  const matchedFields = [];

  for (const [field, rawValue] of Object.entries(rawFields)) {
    const value = safeLower(rawValue);
    if (!value) {
      continue;
    }

    if (value === q) {
      score += 140;
      matchedFields.push(field);
      continue;
    }

    if (value.startsWith(q)) {
      score += 90;
      matchedFields.push(field);
      continue;
    }

    if (value.includes(q)) {
      score += 45;
      matchedFields.push(field);
    }
  }

  return {
    score,
    matchedFields: uniqueStrings(matchedFields),
  };
}

function withEntityBoost(baseScore, entityType) {
  const boosts = {
    user: 40,
    chat: 36,
    group: 34,
    message: 28,
    file: 26,
    notification: 22,
    contact_request: 20,
    report: 18,
  };
  return baseScore + (boosts[entityType] || 10);
}

function sortResults(results) {
  return results.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
}

function buildUserResult(profile, query) {
  const match = scoreTextMatch(query, {
    fullName: profile.fullName,
    username: profile.username,
  });

  return {
    entityType: 'user',
    entityId: String(profile._id),
    title: profile.fullName,
    subtitle: profile.username ? `@${profile.username}` : 'User',
    preview: profile.statusMessage || profile.bio || '',
    matchedFields: match.matchedFields,
    routeHint: buildRouteHint('contacts', { userId: String(profile._id) }),
    icon: 'user',
    media: { image: profile.profileImage || '' },
    score: withEntityBoost(match.score, 'user'),
    createdAt: profile.createdAt || null,
    raw: profile,
  };
}

function buildChatResult(chat, chatDisplay, query, groupByChatId) {
  const group = groupByChatId.get(String(chat._id));
  const match = scoreTextMatch(query, {
    title: chatDisplay.title,
    subtitle: chatDisplay.subtitle,
    preview: chat.lastMessagePreview,
  });

  return {
    entityType: 'chat',
    entityId: String(chat._id),
    title: chatDisplay.title,
    subtitle: chatDisplay.subtitle,
    preview: chat.lastMessagePreview || '',
    matchedFields: uniqueStrings([
      ...match.matchedFields,
      ...(chat.type === 'group' && group ? chatDisplay.matchedFieldsBase : chatDisplay.matchedFieldsBase),
    ]),
    routeHint: buildRouteHint('chats', { chatId: String(chat._id) }),
    icon: chat.type === 'group' ? 'group' : 'chat',
    media: { image: chatDisplay.image || '' },
    score: withEntityBoost(match.score, 'chat') + (chat.type === 'private' ? 8 : 0),
    createdAt: chat.lastMessageAt || chat.createdAt || null,
    raw: {
      id: chat._id,
      type: chat.type,
      title: chatDisplay.title,
      subtitle: chatDisplay.subtitle,
      lastMessagePreview: chat.lastMessagePreview || '',
      lastMessageAt: chat.lastMessageAt || null,
      groupId: group?._id || null,
      archived: Boolean(chat.participantSetting?.archivedAt),
      muted: Boolean(chat.participantSetting?.mutedUntil && new Date(chat.participantSetting.mutedUntil) > new Date()),
      pinned: Boolean(chat.participantSetting?.pinnedAt),
    },
  };
}

function buildGroupResult(group, query) {
  const match = scoreTextMatch(query, {
    name: group.name,
    description: group.description,
  });

  return {
    entityType: 'group',
    entityId: String(group._id),
    title: group.name,
    subtitle: group.description || 'Group',
    preview: group.description || '',
    matchedFields: match.matchedFields,
    routeHint: buildRouteHint('groups', { groupId: String(group._id), chatId: String(group.chatId) }),
    icon: 'group',
    media: { image: group.image || '' },
    score: withEntityBoost(match.score, 'group'),
    createdAt: group.createdAt || null,
    raw: {
      id: group._id,
      chatId: group.chatId,
      name: group.name,
      description: group.description,
      image: group.image,
    },
  };
}

function buildMessageResult(message, query) {
  const preview = message.isEncrypted ? 'Encrypted message' : (message.text || message.fileName || message.type || 'Message');
  const match = scoreTextMatch(query, {
    text: message.text,
    fileName: message.fileName,
    type: message.type,
  });

  return {
    entityType: 'message',
    entityId: String(message._id),
    title: message.fileName || (message.type === 'text' ? 'Message' : `${message.type} message`),
    subtitle: message.type,
    preview: preview.slice(0, 180),
    matchedFields: match.matchedFields,
    routeHint: buildRouteHint('chats', { chatId: String(message.chatId), messageId: String(message._id) }),
    icon: 'message',
    media: {
      image: message.mediaUrl || '',
    },
    score: withEntityBoost(match.score, 'message'),
    createdAt: message.createdAt || null,
    raw: message,
  };
}

function buildFileResult(file, query) {
  const normalized = normalizeMediaMetadata({
    ...file,
    previewUrl: file.mediaUrl || file.previewUrl || '',
  });
  const match = scoreTextMatch(query, {
    fileName: file.fileName,
    mimeType: file.mimeType,
    text: file.text,
  });

  return {
    entityType: 'file',
    entityId: String(file._id),
    title: file.fileName || 'Shared file',
    subtitle: normalized.mediaKind,
    preview: file.mimeType || '',
    matchedFields: match.matchedFields,
    routeHint: buildRouteHint('files', { messageId: String(file._id), chatId: String(file.chatId) }),
    icon: normalized.mediaKind,
    media: {
      image: normalized.thumbnailUrl || normalized.previewUrl || '',
      previewable: normalized.previewable,
    },
    score: withEntityBoost(match.score, 'file'),
    createdAt: file.createdAt || null,
    raw: {
      ...file,
      ...normalized,
    },
  };
}

function buildNotificationResult(notification, query) {
  const match = scoreTextMatch(query, {
    title: notification.title,
    body: notification.body,
    type: notification.type,
  });

  let routeHint = buildRouteHint('notifications', { notificationId: String(notification._id) });
  if (notification.data?.chatId) {
    routeHint = buildRouteHint('chats', {
      chatId: String(notification.data.chatId),
      messageId: notification.data.messageId ? String(notification.data.messageId) : null,
    });
  } else if (notification.data?.reportId) {
    routeHint = buildRouteHint('admin', { reportId: String(notification.data.reportId) });
  } else if (notification.data?.requestId) {
    routeHint = buildRouteHint('requests', { requestId: String(notification.data.requestId) });
  }

  return {
    entityType: 'notification',
    entityId: String(notification._id),
    title: notification.title,
    subtitle: notification.type,
    preview: notification.body || '',
    matchedFields: match.matchedFields,
    routeHint,
    icon: 'notification',
    media: {},
    score: withEntityBoost(match.score, 'notification') + (notification.isRead ? 0 : 4),
    createdAt: notification.createdAt || null,
    raw: notification,
  };
}

function buildContactRequestResult(request, counterpart, query, userId) {
  const outgoing = String(request.senderId?._id || request.senderId) === String(userId);
  const title = counterpart?.fullName || counterpart?.username || 'Contact request';
  const subtitle = outgoing ? 'Outgoing request' : 'Incoming request';
  const match = scoreTextMatch(query, {
    fullName: counterpart?.fullName,
    username: counterpart?.username,
    status: request.status,
    subtitle,
  });

  return {
    entityType: 'contact_request',
    entityId: String(request._id),
    title,
    subtitle,
    preview: request.status,
    matchedFields: match.matchedFields,
    routeHint: buildRouteHint('requests', { requestId: String(request._id) }),
    icon: 'request',
    media: { image: counterpart?.profileImage || '' },
    score: withEntityBoost(match.score, 'contact_request'),
    createdAt: request.createdAt || null,
    raw: {
      id: request._id,
      status: request.status,
      senderId: toId(request.senderId),
      receiverId: toId(request.receiverId),
      counterpart: counterpart || null,
    },
  };
}

function buildReportResult(report, query) {
  const match = scoreTextMatch(query, {
    reason: report.reason,
    status: report.status,
    moderationNotes: report.moderationNotes,
  });

  return {
    entityType: 'report',
    entityId: String(report._id),
    title: report.reason || 'Report',
    subtitle: report.status,
    preview: report.moderationNotes || '',
    matchedFields: match.matchedFields,
    routeHint: buildRouteHint('admin', { reportId: String(report._id) }),
    icon: 'report',
    media: {},
    score: withEntityBoost(match.score, 'report'),
    createdAt: report.createdAt || null,
    raw: report,
  };
}

async function searchWorkspace(userId, query) {
  const limit = Number(query.limit || 5);
  const q = normalizeQuery(query.q);
  const regex = new RegExp(escapeRegex(q), 'i');

  const currentUser = await User.findById(userId).select('_id role').lean();

  const memberChats = await Chat.find({ memberIds: userId })
    .select('_id type memberIds lastMessagePreview lastMessageAt participantSettings createdAt')
    .populate('memberIds', 'fullName username profileImage')
    .sort({ lastMessageAt: -1, updatedAt: -1 })
    .lean();

  const accessibleChatIds = memberChats.map((chat) => chat._id);
  const groupChatIds = memberChats.filter((chat) => chat.type === 'group').map((chat) => chat._id);

  const [userDocs, groupDocs, messageDocs, fileDocs, notificationDocs, reportDocs, contactRequestDocs] = await Promise.all([
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
      .select('_id chatId senderId text fileName type mediaUrl createdAt isEncrypted mimeType'),
    Message.find({
      chatId: { $in: accessibleChatIds },
      deletedForEveryone: false,
      mediaUrl: { $ne: '' },
      $or: [{ fileName: regex }, { mimeType: regex }, { text: regex }],
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('_id chatId senderId type fileName text mediaUrl mimeType fileSize duration createdAt thumbnailUrl width height aspectRatio extension pages metadataProcessingStatus'),
    Notification.find({
      userId,
      $or: [{ title: regex }, { body: regex }, { type: regex }],
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    Report.find(currentUser?.role === 'admin'
      ? {
        $or: [{ reason: regex }, { moderationNotes: regex }, { status: regex }],
      }
      : {
        reporterUserId: userId,
        $or: [{ reason: regex }, { moderationNotes: regex }, { status: regex }],
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    ContactRequest.find({
      $or: [{ senderId: userId }, { receiverId: userId }],
      status: { $in: ['pending', 'accepted', 'rejected', 'cancelled'] },
    })
      .populate('senderId', 'fullName username profileImage')
      .populate('receiverId', 'fullName username profileImage')
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const groupByChatId = new Map(groupDocs.map((group) => [String(group.chatId), group]));

  const users = [];
  for (const userDoc of userDocs) {
    const profile = await userService.buildPublicProfile(userId, userDoc);
    users.push(buildUserResult(profile, q));
  }

  const chats = memberChats
    .map((chat) => {
      const chatDisplay = buildChatDisplay(chat, userId, groupByChatId);
      const participantSetting = (chat.participantSettings || []).find((item) => String(item.userId) === String(userId)) || null;
      const result = buildChatResult(
        { ...chat, participantSetting },
        chatDisplay,
        q,
        groupByChatId,
      );
      return result.score > withEntityBoost(0, 'chat') ? result : null;
    })
    .filter(Boolean)
    .slice(0, limit);

  const groups = groupDocs
    .map((group) => buildGroupResult(group, q))
    .filter((item) => item.score > withEntityBoost(0, 'group'))
    .slice(0, limit);

  const messages = messageDocs
    .map((message) => buildMessageResult(message, q))
    .filter((item) => item.score > withEntityBoost(0, 'message'))
    .slice(0, limit);

  const files = fileDocs
    .map((file) => buildFileResult(file, q))
    .filter((item) => item.score > withEntityBoost(0, 'file'))
    .slice(0, limit);

  const notifications = notificationDocs
    .map((notification) => buildNotificationResult(notification, q))
    .filter((item) => item.score > withEntityBoost(0, 'notification'))
    .slice(0, limit);

  const reports = reportDocs
    .map((report) => buildReportResult(report, q))
    .filter((item) => item.score > withEntityBoost(0, 'report'))
    .slice(0, limit);

  const contactRequests = contactRequestDocs
    .map((request) => {
      const counterpart = String(request.senderId?._id || request.senderId) === String(userId)
        ? request.receiverId
        : request.senderId;
      const result = buildContactRequestResult(request, counterpart, q, userId);
      return result.score > withEntityBoost(0, 'contact_request') ? result : null;
    })
    .filter(Boolean)
    .slice(0, limit);

  const results = sortResults([
    ...users,
    ...chats,
    ...groups,
    ...messages,
    ...files,
    ...notifications,
    ...reports,
    ...contactRequests,
  ]);

  return {
    query: q,
    results,
    grouped: {
      users,
      chats,
      groups,
      messages,
      files,
      notifications,
      reports,
      contactRequests,
    },
    meta: {
      limit,
      totalResults: results.length,
      counts: {
        users: users.length,
        chats: chats.length,
        groups: groups.length,
        messages: messages.length,
        files: files.length,
        notifications: notifications.length,
        reports: reports.length,
        contactRequests: contactRequests.length,
      },
    },
    users: users.map((item) => item.raw),
    chats: chats.map((item) => item.raw),
    groups: groups.map((item) => item.raw),
    messages: messages.map((item) => item.raw),
    files: files.map((item) => item.raw),
    notifications: notifications.map((item) => item.raw),
    reports: reports.map((item) => item.raw),
    contactRequests: contactRequests.map((item) => item.raw),
  };
}

module.exports = {
  searchWorkspace,
};
