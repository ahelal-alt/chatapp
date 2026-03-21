const test = require('node:test');
const assert = require('node:assert/strict');

const Notification = require('../src/modules/notifications/notification.model');
const User = require('../src/modules/users/user.model');
const Chat = require('../src/modules/chats/chat.model');
const Message = require('../src/modules/messages/message.model');
const Group = require('../src/modules/groups/group.model');
const ContactRequest = require('../src/modules/contacts/contactRequest.model');
const GroupJoinRequest = require('../src/modules/groups/groupJoinRequest.model');
const Report = require('../src/modules/reports/report.model');
const Call = require('../src/modules/calls/call.model');
const Invite = require('../src/modules/invites/invite.model');
const notificationService = require('../src/modules/notifications/notification.service');

function chainable(value) {
  return {
    select() {
      return this;
    },
    populate() {
      return this;
    },
    lean: async () => value,
  };
}

let originals;

test.beforeEach(() => {
  originals = {
    notificationFindOne: Notification.findOne,
    userFindById: User.findById,
    chatFindById: Chat.findById,
    messageFindById: Message.findById,
    groupFindById: Group.findById,
    contactRequestFindById: ContactRequest.findById,
    groupJoinRequestFindById: GroupJoinRequest.findById,
    reportFindById: Report.findById,
    callFindById: Call.findById,
    inviteFindById: Invite.findById,
  };
});

test.afterEach(() => {
  Notification.findOne = originals.notificationFindOne;
  User.findById = originals.userFindById;
  Chat.findById = originals.chatFindById;
  Message.findById = originals.messageFindById;
  Group.findById = originals.groupFindById;
  ContactRequest.findById = originals.contactRequestFindById;
  GroupJoinRequest.findById = originals.groupJoinRequestFindById;
  Report.findById = originals.reportFindById;
  Call.findById = originals.callFindById;
  Invite.findById = originals.inviteFindById;
});

test('hydrates message notifications with actor, message, chat, and route hint', async () => {
  Notification.findOne = () => chainable({
    _id: 'notif-1',
    userId: 'user-1',
    type: 'private_message',
    title: 'New message',
    body: 'You received a new message',
    isRead: false,
    createdAt: new Date('2026-03-21T02:00:00.000Z'),
    data: {
      chatId: 'chat-1',
      messageId: 'message-1',
      senderId: 'user-2',
    },
  });
  User.findById = () => chainable({
    _id: 'user-2',
    fullName: 'Sender User',
    username: 'sender',
    profileImage: '/uploads/sender.png',
    role: 'user',
  });
  Chat.findById = () => chainable({
    _id: 'chat-1',
    type: 'private',
    lastMessagePreview: 'Hello there',
    lastMessageAt: new Date('2026-03-21T01:59:00.000Z'),
  });
  Message.findById = () => chainable({
    _id: 'message-1',
    chatId: 'chat-1',
    senderId: 'user-2',
    type: 'text',
    text: 'Hello there',
    createdAt: new Date('2026-03-21T01:59:00.000Z'),
    isEncrypted: false,
  });

  const result = await notificationService.getNotificationDetails('user-1', 'notif-1');

  assert.equal(result.entityType, 'message');
  assert.equal(result.actor.username, 'sender');
  assert.equal(result.context.message.preview, 'Hello there');
  assert.equal(result.context.chat.id, 'chat-1');
  assert.equal(result.route.section, 'chats');
  assert.equal(result.route.params.messageId, 'message-1');
});

test('hydrates contact request notifications with request summary and actor', async () => {
  Notification.findOne = () => chainable({
    _id: 'notif-2',
    userId: 'user-1',
    type: 'contact_request_received',
    title: 'New contact request',
    body: 'You have received a new contact request',
    isRead: false,
    createdAt: new Date(),
    data: {
      requestId: 'request-1',
      senderId: 'user-3',
    },
  });
  ContactRequest.findById = () => chainable({
    _id: 'request-1',
    senderId: 'user-3',
    receiverId: 'user-1',
    status: 'pending',
    createdAt: new Date('2026-03-21T02:05:00.000Z'),
  });
  User.findById = () => chainable({
    _id: 'user-3',
    fullName: 'Contact Sender',
    username: 'contact.sender',
    profileImage: '',
    role: 'user',
  });

  const result = await notificationService.getNotificationDetails('user-1', 'notif-2');

  assert.equal(result.entityType, 'contact_request');
  assert.equal(result.actor.id, 'user-3');
  assert.equal(result.context.contactRequest.status, 'pending');
  assert.equal(result.route.section, 'requests');
});

test('hydrates group join request notifications with request, group, chat, and actor', async () => {
  Notification.findOne = () => chainable({
    _id: 'notif-3',
    userId: 'admin-1',
    type: 'group_join_request',
    title: 'Join request received',
    body: 'A user requested to join your group',
    isRead: false,
    createdAt: new Date(),
    data: {
      groupId: 'group-1',
      joinRequestId: 'join-request-1',
      chatId: 'chat-3',
    },
  });
  GroupJoinRequest.findById = () => chainable({
    _id: 'join-request-1',
    groupId: 'group-1',
    requesterUserId: 'user-8',
    reviewedByUserId: null,
    status: 'pending',
    message: 'Please add me',
    createdAt: new Date('2026-03-21T02:06:00.000Z'),
    reviewedAt: null,
  });
  Group.findById = () => chainable({
    _id: 'group-1',
    chatId: 'chat-3',
    name: 'Engineering',
    description: 'Team group',
    image: '',
  });
  Chat.findById = () => chainable({
    _id: 'chat-3',
    type: 'group',
    lastMessagePreview: 'Welcome',
    lastMessageAt: new Date('2026-03-21T02:01:00.000Z'),
  });
  User.findById = () => chainable({
    _id: 'user-8',
    fullName: 'Join Requester',
    username: 'joiner',
    profileImage: '',
    role: 'user',
  });

  const result = await notificationService.getNotificationDetails('admin-1', 'notif-3');

  assert.equal(result.entityType, 'group_join_request');
  assert.equal(result.actor.username, 'joiner');
  assert.equal(result.context.joinRequest.message, 'Please add me');
  assert.equal(result.context.group.name, 'Engineering');
  assert.equal(result.route.section, 'groups');
});

test('hydrates report notifications with report summary and route hint', async () => {
  Notification.findOne = () => chainable({
    _id: 'notif-4',
    userId: 'admin-1',
    type: 'moderation',
    title: 'Report updated',
    body: 'A report needs review',
    isRead: true,
    createdAt: new Date(),
    data: {
      reportId: 'report-1',
      actorUserId: 'admin-2',
    },
  });
  Report.findById = () => chainable({
    _id: 'report-1',
    reporterUserId: 'user-9',
    targetUserId: 'user-10',
    targetMessageId: 'message-77',
    reason: 'Abuse',
    status: 'open',
    reviewedByUserId: null,
    reviewedAt: null,
  });
  User.findById = () => chainable({
    _id: 'admin-2',
    fullName: 'Moderator',
    username: 'moderator',
    profileImage: '',
    role: 'admin',
  });

  const result = await notificationService.getNotificationDetails('admin-1', 'notif-4');

  assert.equal(result.entityType, 'report');
  assert.equal(result.actor.role, 'admin');
  assert.equal(result.context.report.reason, 'Abuse');
  assert.equal(result.route.section, 'admin');
});

test('returns null-safe payload when related entities are missing', async () => {
  Notification.findOne = () => chainable({
    _id: 'notif-5',
    userId: 'user-1',
    type: 'call',
    title: 'Missed call',
    body: 'You missed a call',
    isRead: false,
    createdAt: new Date(),
    data: {
      callId: 'call-1',
      chatId: 'chat-9',
    },
  });
  Call.findById = () => chainable(null);
  Chat.findById = () => chainable(null);
  User.findById = () => chainable(null);

  const result = await notificationService.getNotificationDetails('user-1', 'notif-5');

  assert.equal(result.entityType, 'call');
  assert.equal(result.actor, null);
  assert.equal(result.target.exists, false);
  assert.equal(result.context.call, null);
});
