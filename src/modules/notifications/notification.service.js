const Notification = require('./notification.model');
const User = require('../users/user.model');
const Chat = require('../chats/chat.model');
const Message = require('../messages/message.model');
const Group = require('../groups/group.model');
const ContactRequest = require('../contacts/contactRequest.model');
const GroupJoinRequest = require('../groups/groupJoinRequest.model');
const Report = require('../reports/report.model');
const Call = require('../calls/call.model');
const Invite = require('../invites/invite.model');
const ApiError = require('../../utils/ApiError');
const { getPagination, buildPaginationMeta } = require('../../utils/pagination');
const { getIO } = require('../../sockets/state');

function toId(value) {
  if (!value) {
    return null;
  }
  return String(value._id || value);
}

function buildUserSummary(user) {
  if (!user) {
    return null;
  }

  return {
    id: toId(user),
    fullName: user.fullName || '',
    username: user.username || '',
    profileImage: user.profileImage || '',
    role: user.role || 'user',
  };
}

function buildMessagePreview(message) {
  if (!message) {
    return '';
  }
  if (message.isEncrypted) {
    return 'Encrypted message';
  }
  if (message.text) {
    return String(message.text).slice(0, 140);
  }
  if (message.fileName) {
    return message.fileName;
  }
  if (message.type === 'voice') {
    return 'Voice message';
  }
  if (message.type === 'image') {
    return 'Image';
  }
  if (message.type === 'video') {
    return 'Video';
  }
  if (message.type === 'audio') {
    return 'Audio';
  }
  if (message.type === 'file') {
    return 'File';
  }
  return 'Message';
}

function buildChatSummary(chat) {
  if (!chat) {
    return null;
  }

  return {
    id: toId(chat),
    type: chat.type,
    lastMessagePreview: chat.lastMessagePreview || '',
    lastMessageAt: chat.lastMessageAt || null,
  };
}

function buildGroupSummary(group) {
  if (!group) {
    return null;
  }

  return {
    id: toId(group),
    chatId: toId(group.chatId),
    name: group.name || '',
    description: group.description || '',
    image: group.image || '',
  };
}

function buildMessageSummary(message) {
  if (!message) {
    return null;
  }

  return {
    id: toId(message),
    chatId: toId(message.chatId),
    senderId: toId(message.senderId),
    type: message.type,
    preview: buildMessagePreview(message),
    mediaUrl: message.mediaUrl || '',
    mimeType: message.mimeType || '',
    fileName: message.fileName || '',
    fileSize: message.fileSize || 0,
    duration: message.duration || 0,
    createdAt: message.createdAt || null,
    isEncrypted: Boolean(message.isEncrypted),
  };
}

function buildContactRequestSummary(request) {
  if (!request) {
    return null;
  }

  return {
    id: toId(request),
    senderId: toId(request.senderId),
    receiverId: toId(request.receiverId),
    status: request.status,
    createdAt: request.createdAt || null,
  };
}

function buildGroupJoinRequestSummary(request) {
  if (!request) {
    return null;
  }

  return {
    id: toId(request),
    groupId: toId(request.groupId),
    requesterUserId: toId(request.requesterUserId),
    reviewedByUserId: toId(request.reviewedByUserId),
    status: request.status,
    message: request.message || '',
    createdAt: request.createdAt || null,
    reviewedAt: request.reviewedAt || null,
  };
}

function buildReportSummary(report) {
  if (!report) {
    return null;
  }

  return {
    id: toId(report),
    status: report.status,
    reason: report.reason || '',
    targetUserId: toId(report.targetUserId),
    targetMessageId: toId(report.targetMessageId),
    reviewedAt: report.reviewedAt || null,
  };
}

function buildCallSummary(call) {
  if (!call) {
    return null;
  }

  return {
    id: toId(call),
    chatId: toId(call.chatId),
    type: call.type,
    status: call.status,
    participantCount: Array.isArray(call.participants) ? call.participants.length : 0,
    startedAt: call.startedAt || null,
    endedAt: call.endedAt || null,
  };
}

function buildInviteSummary(invite) {
  if (!invite) {
    return null;
  }

  return {
    id: toId(invite),
    email: invite.email || '',
    status: invite.status,
    expiresAt: invite.expiresAt || null,
    acceptedAt: invite.acceptedAt || null,
  };
}

function buildSystemSummary(notification) {
  return {
    title: notification.title || '',
    body: notification.body || '',
  };
}

function buildRouteHint(entityType, ids = {}) {
  switch (entityType) {
    case 'message':
      return ids.chatId ? {
        section: 'chats',
        params: {
          chatId: ids.chatId,
          messageId: ids.messageId || null,
        },
      } : null;
    case 'group':
      return {
        section: ids.chatId ? 'chats' : 'groups',
        params: {
          groupId: ids.groupId || null,
          chatId: ids.chatId || null,
        },
      };
    case 'contact_request':
      return {
        section: 'requests',
        params: {
          requestId: ids.requestId || null,
        },
      };
    case 'group_join_request':
      return {
        section: 'groups',
        params: {
          groupId: ids.groupId || null,
          chatId: ids.chatId || null,
          joinRequestId: ids.joinRequestId || null,
        },
      };
    case 'invite':
      return {
        section: 'invites',
        params: {
          inviteId: ids.inviteId || null,
        },
      };
    case 'report':
      return {
        section: 'admin',
        params: {
          reportId: ids.reportId || null,
        },
      };
    case 'call':
      return {
        section: 'calls',
        params: {
          callId: ids.callId || null,
          chatId: ids.chatId || null,
        },
      };
    default:
      return ids.chatId ? {
        section: 'chats',
        params: {
          chatId: ids.chatId,
        },
      } : null;
  }
}

function classifyNotification(notification) {
  const data = notification.data || {};

  if (notification.type === 'private_message'
    || notification.type === 'group_message'
    || notification.type === 'mention'
    || notification.type === 'reaction') {
    return 'message';
  }

  if (notification.type === 'contact_request_received' || notification.type === 'contact_request_accepted') {
    return 'contact_request';
  }

  if (notification.type === 'group_join_request') {
    return 'group_join_request';
  }

  if (notification.type === 'added_to_group'
    || notification.type === 'promoted_to_admin'
    || notification.type === 'group_ownership_transferred'
    || notification.type === 'group_joined_via_invite'
    || notification.type === 'group_join_request_rejected') {
    return 'group';
  }

  if (notification.type === 'invite') {
    return 'invite';
  }

  if (notification.type === 'report'
    || notification.type === 'moderation'
    || notification.type === 'system_admin'
    || notification.type === 'admin_event') {
    return 'report';
  }

  if (notification.type === 'call') {
    return 'call';
  }

  if (data.messageId) {
    return 'message';
  }
  if (data.requestId) {
    return 'contact_request';
  }
  if (data.joinRequestId) {
    return 'group_join_request';
  }
  if (data.groupId) {
    return 'group';
  }
  if (data.inviteId) {
    return 'invite';
  }
  if (data.reportId) {
    return 'report';
  }
  if (data.callId) {
    return 'call';
  }
  if (data.chatId) {
    return 'chat';
  }
  return 'system';
}

async function emitUnreadCount(userId) {
  const io = getIO();

  if (!io) {
    return 0;
  }

  const unreadCount = await Notification.countDocuments({ userId, isRead: false });
  io.to(`user:${userId}`).emit('notification:count', { unreadCount });
  return unreadCount;
}

async function createNotification(payload) {
  const notification = await Notification.create(payload);
  const io = getIO();

  if (io) {
    io.to(`user:${payload.userId}`).emit('notification:new', notification);
  }

  await emitUnreadCount(payload.userId);

  return notification;
}

async function listNotifications(userId, query) {
  const { page, limit, skip } = getPagination(query);

  const [items, total] = await Promise.all([
    Notification.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Notification.countDocuments({ userId }),
  ]);

  return {
    items,
    meta: buildPaginationMeta({ page, limit, total }),
  };
}

async function getNotificationDetails(userId, notificationId) {
  const notification = await Notification.findOne({ _id: notificationId, userId }).lean();

  if (!notification) {
    throw new ApiError(404, 'Notification not found');
  }

  const data = notification.data || {};
  const entityType = classifyNotification(notification);

  const related = {
    actor: null,
    target: null,
    chat: null,
    group: null,
    message: null,
    contactRequest: null,
    joinRequest: null,
    invite: null,
    report: null,
    call: null,
  };

  let actorId = data.actorUserId || data.senderId || data.userId || null;
  let entityId = null;

  if (data.chatId) {
    related.chat = await Chat.findById(data.chatId)
      .select('_id type lastMessagePreview lastMessageAt')
      .lean();
  }

  if (entityType === 'message' && data.messageId) {
    related.message = await Message.findById(data.messageId)
      .select('_id chatId senderId type text mediaUrl mimeType fileName fileSize duration createdAt isEncrypted')
      .lean();
    entityId = data.messageId;
    actorId = actorId || toId(related.message?.senderId);
    if (!related.chat && related.message?.chatId) {
      related.chat = await Chat.findById(related.message.chatId)
        .select('_id type lastMessagePreview lastMessageAt')
        .lean();
    }
  }

  if (entityType === 'contact_request' && data.requestId) {
    related.contactRequest = await ContactRequest.findById(data.requestId)
      .select('_id senderId receiverId status createdAt')
      .lean();
    entityId = data.requestId;
    actorId = actorId || toId(
      notification.type === 'contact_request_accepted'
        ? related.contactRequest?.receiverId
        : related.contactRequest?.senderId,
    );
  }

  if (entityType === 'group_join_request' && data.joinRequestId) {
    related.joinRequest = await GroupJoinRequest.findById(data.joinRequestId)
      .select('_id groupId requesterUserId reviewedByUserId status message createdAt reviewedAt')
      .lean();
    entityId = data.joinRequestId;
    actorId = actorId || toId(related.joinRequest?.requesterUserId);
    if (!related.group && (data.groupId || related.joinRequest?.groupId)) {
      related.group = await Group.findById(data.groupId || related.joinRequest.groupId)
        .select('_id chatId name description image')
        .lean();
    }
    if (!related.chat && related.group?.chatId) {
      related.chat = await Chat.findById(related.group.chatId)
        .select('_id type lastMessagePreview lastMessageAt')
        .lean();
    }
  }

  if (entityType === 'group') {
    const groupId = data.groupId || null;
    if (groupId) {
      related.group = await Group.findById(groupId)
        .select('_id chatId name description image')
        .lean();
      entityId = groupId;
    }
    if (!related.chat && (data.chatId || related.group?.chatId)) {
      related.chat = await Chat.findById(data.chatId || related.group.chatId)
        .select('_id type lastMessagePreview lastMessageAt')
        .lean();
    }
  }

  if (entityType === 'invite' && data.inviteId) {
    related.invite = await Invite.findById(data.inviteId)
      .select('_id email status expiresAt acceptedAt invitedByUserId acceptedByUserId')
      .lean();
    entityId = data.inviteId;
    actorId = actorId || toId(related.invite?.invitedByUserId);
  }

  if (entityType === 'report' && data.reportId) {
    related.report = await Report.findById(data.reportId)
      .select('_id reporterUserId targetUserId targetMessageId reason status reviewedByUserId reviewedAt')
      .lean();
    entityId = data.reportId;
    actorId = actorId || toId(related.report?.reporterUserId) || toId(related.report?.reviewedByUserId);
  }

  if (entityType === 'call' && data.callId) {
    related.call = await Call.findById(data.callId)
      .select('_id chatId createdBy type status participants startedAt endedAt')
      .lean();
    entityId = data.callId;
    actorId = actorId || toId(related.call?.createdBy);
    if (!related.chat && related.call?.chatId) {
      related.chat = await Chat.findById(related.call.chatId)
        .select('_id type lastMessagePreview lastMessageAt')
        .lean();
    }
  }

  if (entityType === 'chat' && data.chatId) {
    entityId = data.chatId;
  }

  if (actorId) {
    related.actor = await User.findById(actorId)
      .select('_id fullName username profileImage role')
      .lean();
  }

  let targetSummary = null;
  if (entityType === 'message') {
    targetSummary = buildMessageSummary(related.message);
  } else if (entityType === 'contact_request') {
    targetSummary = buildContactRequestSummary(related.contactRequest);
  } else if (entityType === 'group_join_request') {
    targetSummary = buildGroupJoinRequestSummary(related.joinRequest);
  } else if (entityType === 'group') {
    targetSummary = buildGroupSummary(related.group);
  } else if (entityType === 'invite') {
    targetSummary = buildInviteSummary(related.invite);
  } else if (entityType === 'report') {
    targetSummary = buildReportSummary(related.report);
  } else if (entityType === 'call') {
    targetSummary = buildCallSummary(related.call);
  } else if (entityType === 'chat') {
    targetSummary = buildChatSummary(related.chat);
  } else {
    targetSummary = buildSystemSummary(notification);
  }

  return {
    id: toId(notification),
    type: notification.type,
    title: notification.title,
    body: notification.body,
    isRead: Boolean(notification.isRead),
    createdAt: notification.createdAt || null,
    data,
    actor: buildUserSummary(related.actor),
    entityType,
    entityId,
    target: {
      entityType,
      entityId,
      exists: Boolean(targetSummary),
      summary: targetSummary,
    },
    context: {
      chat: buildChatSummary(related.chat),
      group: buildGroupSummary(related.group),
      message: buildMessageSummary(related.message),
      contactRequest: buildContactRequestSummary(related.contactRequest),
      joinRequest: buildGroupJoinRequestSummary(related.joinRequest),
      invite: buildInviteSummary(related.invite),
      report: buildReportSummary(related.report),
      call: buildCallSummary(related.call),
    },
      route: buildRouteHint(entityType, {
      chatId: toId(related.chat),
      groupId: toId(related.group),
      messageId: toId(related.message) || data.messageId || null,
      requestId: toId(related.contactRequest) || data.requestId || null,
      joinRequestId: toId(related.joinRequest) || data.joinRequestId || null,
      inviteId: toId(related.invite) || data.inviteId || null,
      reportId: toId(related.report) || data.reportId || null,
      callId: toId(related.call) || data.callId || null,
    }),
  };
}

async function markRead(userId, notificationId) {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, userId },
    { isRead: true },
    { new: true },
  );

  if (!notification) {
    throw new ApiError(404, 'Notification not found');
  }

  const io = getIO();
  if (io) {
    io.to(`user:${userId}`).emit('notification:read', { notificationId });
  }

  await emitUnreadCount(userId);

  return notification;
}

async function markAllRead(userId) {
  await Notification.updateMany({ userId, isRead: false }, { isRead: true });

  const io = getIO();
  if (io) {
    io.to(`user:${userId}`).emit('notification:read', { all: true });
  }

  await emitUnreadCount(userId);
}

async function getUnreadCount(userId) {
  return Notification.countDocuments({ userId, isRead: false });
}

module.exports = {
  createNotification,
  listNotifications,
  getNotificationDetails,
  markRead,
  markAllRead,
  getUnreadCount,
  emitUnreadCount,
};
