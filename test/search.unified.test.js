const test = require('node:test');
const assert = require('node:assert/strict');

const User = require('../src/modules/users/user.model');
const Chat = require('../src/modules/chats/chat.model');
const Group = require('../src/modules/groups/group.model');
const Message = require('../src/modules/messages/message.model');
const Notification = require('../src/modules/notifications/notification.model');
const Report = require('../src/modules/reports/report.model');
const ContactRequest = require('../src/modules/contacts/contactRequest.model');
const userService = require('../src/modules/users/user.service');
const searchService = require('../src/modules/search/search.service');

function chainable(value) {
  return {
    select() { return this; },
    populate() { return this; },
    sort() { return this; },
    limit() { return this; },
    skip() { return this; },
    lean: async () => value,
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

let originals;

test.beforeEach(() => {
  originals = {
    userFindById: User.findById,
    userFind: User.find,
    chatFind: Chat.find,
    groupFind: Group.find,
    messageFind: Message.find,
    notificationFind: Notification.find,
    reportFind: Report.find,
    contactRequestFind: ContactRequest.find,
    buildPublicProfile: userService.buildPublicProfile,
  };
});

test.afterEach(() => {
  User.findById = originals.userFindById;
  User.find = originals.userFind;
  Chat.find = originals.chatFind;
  Group.find = originals.groupFind;
  Message.find = originals.messageFind;
  Notification.find = originals.notificationFind;
  Report.find = originals.reportFind;
  ContactRequest.find = originals.contactRequestFind;
  userService.buildPublicProfile = originals.buildPublicProfile;
});

test('unified search returns grouped and mixed results across supported entities', async () => {
  User.findById = () => chainable({ _id: 'viewer-1', role: 'admin' });
  let messageFindCalls = 0;

  User.find = () => chainable([
    {
      _id: 'user-2',
      fullName: 'Sara Ahmed',
      username: 'sara',
      profileImage: '',
      statusMessage: 'Available',
      toJSON() { return this; },
    },
  ]);
  userService.buildPublicProfile = async (_viewerId, user) => ({
    ...user,
    toJSON: undefined,
  });

  Chat.find = () => chainable([
    {
      _id: 'chat-1',
      type: 'private',
      memberIds: [
        { _id: 'viewer-1', fullName: 'Viewer', username: 'viewer', profileImage: '' },
        { _id: 'user-2', fullName: 'Sara Ahmed', username: 'sara', profileImage: '/uploads/sara.png' },
      ],
      lastMessagePreview: 'Hello from Sara',
      lastMessageAt: new Date('2026-03-21T01:00:00.000Z'),
      participantSettings: [{ userId: 'viewer-1' }],
      createdAt: new Date('2026-03-20T01:00:00.000Z'),
    },
    {
      _id: 'chat-2',
      type: 'group',
      memberIds: [{ _id: 'viewer-1' }, { _id: 'user-3' }],
      lastMessagePreview: 'Engineering update',
      lastMessageAt: new Date('2026-03-21T02:00:00.000Z'),
      participantSettings: [{ userId: 'viewer-1' }],
      createdAt: new Date('2026-03-20T02:00:00.000Z'),
    },
  ]);

  Group.find = () => chainable([
    {
      _id: 'group-1',
      chatId: 'chat-2',
      name: 'Engineering',
      description: 'Product engineering team',
      image: '',
      createdAt: new Date('2026-03-19T00:00:00.000Z'),
    },
  ]);

  Message.find = () => {
    messageFindCalls += 1;
    if (messageFindCalls === 1) {
      return chainable([
        {
          _id: 'message-1',
          chatId: 'chat-1',
          senderId: 'user-2',
          text: 'Hello from Sara',
          fileName: '',
          type: 'text',
          mediaUrl: '',
          createdAt: new Date('2026-03-21T01:00:00.000Z'),
          isEncrypted: false,
          mimeType: '',
        },
      ]);
    }

    return chainable([
      {
        _id: 'file-1',
        chatId: 'chat-2',
        senderId: 'user-3',
        type: 'file',
        fileName: 'engineering-plan.pdf',
        text: '',
        mediaUrl: '/uploads/engineering-plan.pdf',
        mimeType: 'application/pdf',
        fileSize: 1024,
        duration: 0,
        createdAt: new Date('2026-03-21T00:00:00.000Z'),
        thumbnailUrl: '',
      },
    ]);
  };

  Notification.find = () => chainable([
    {
      _id: 'notif-1',
      title: 'Engineering alert',
      body: 'Engineering update posted',
      type: 'group_message',
      data: { chatId: 'chat-2', messageId: 'message-1' },
      isRead: false,
      createdAt: new Date('2026-03-21T02:10:00.000Z'),
    },
  ]);

  Report.find = () => chainable([
    {
      _id: 'report-1',
      reason: 'Engineering abuse',
      status: 'open',
      moderationNotes: 'Needs review',
      createdAt: new Date('2026-03-21T02:12:00.000Z'),
    },
  ]);

  ContactRequest.find = () => chainable([
    {
      _id: 'request-1',
      senderId: { _id: 'user-4', fullName: 'Engineer One', username: 'eng1', profileImage: '' },
      receiverId: { _id: 'viewer-1', fullName: 'Viewer', username: 'viewer', profileImage: '' },
      status: 'pending',
      createdAt: new Date('2026-03-21T02:11:00.000Z'),
    },
  ]);

  const result = await searchService.searchWorkspace('viewer-1', { q: 'eng', limit: 5 });

  assert.ok(result.results.length >= 5);
  assert.equal(result.grouped.notifications.length, 1);
  assert.equal(result.grouped.reports.length, 1);
  assert.equal(result.grouped.contactRequests.length, 1);
  assert.ok(result.results.some((item) => item.entityType === 'notification'));
  assert.ok(result.results.some((item) => item.entityType === 'report'));
  assert.ok(result.results.some((item) => item.entityType === 'contact_request'));
  assert.ok(result.results.some((item) => item.entityType === 'chat'));
  assert.ok(result.results.some((item) => item.entityType === 'group'));
  assert.ok(result.results.some((item) => item.entityType === 'file'));
});

test('direct chat search uses participant identity instead of preview only', async () => {
  User.findById = () => chainable({ _id: 'viewer-1', role: 'user' });
  User.find = () => chainable([]);
  userService.buildPublicProfile = async (_viewerId, user) => user;
  Chat.find = () => chainable([
    {
      _id: 'chat-1',
      type: 'private',
      memberIds: [
        { _id: 'viewer-1', fullName: 'Viewer', username: 'viewer', profileImage: '' },
        { _id: 'user-2', fullName: 'Sara Ali', username: 'sara', profileImage: '/uploads/sara.png' },
      ],
      lastMessagePreview: 'Completely unrelated preview',
      lastMessageAt: new Date('2026-03-21T01:00:00.000Z'),
      participantSettings: [{ userId: 'viewer-1' }],
      createdAt: new Date('2026-03-20T01:00:00.000Z'),
    },
  ]);
  Group.find = () => chainable([]);
  Message.find = () => chainable([]);
  Notification.find = () => chainable([]);
  Report.find = () => chainable([]);
  ContactRequest.find = () => chainable([]);

  const result = await searchService.searchWorkspace('viewer-1', { q: 'sara', limit: 5 });

  assert.equal(result.grouped.chats.length, 1);
  assert.equal(result.grouped.chats[0].title, 'Sara Ali');
  assert.ok(result.grouped.chats[0].matchedFields.includes('title'));
});

test('report search scope is restricted for non-admin users', async () => {
  User.findById = () => chainable({ _id: 'viewer-1', role: 'user' });
  User.find = () => chainable([]);
  userService.buildPublicProfile = async (_viewerId, user) => user;
  Chat.find = () => chainable([]);
  Group.find = () => chainable([]);
  Message.find = () => chainable([]);
  Notification.find = () => chainable([]);
  ContactRequest.find = () => chainable([]);

  let capturedReportCriteria = null;
  Report.find = (criteria) => {
    capturedReportCriteria = criteria;
    return chainable([]);
  };

  await searchService.searchWorkspace('viewer-1', { q: 'abuse', limit: 5 });

  assert.equal(String(capturedReportCriteria.reporterUserId), 'viewer-1');
});
