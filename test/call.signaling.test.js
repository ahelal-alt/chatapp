const test = require('node:test');
const assert = require('node:assert/strict');

const Call = require('../src/modules/calls/call.model');
const chatService = require('../src/modules/chats/chat.service');
const callService = require('../src/modules/calls/call.service');
const { registerCallSocket } = require('../src/sockets/call.socket');

function chainable(value) {
  return {
    populate() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    select() { return this; },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

function buildCallDoc(overrides = {}) {
  return {
    _id: overrides._id || 'call-1',
    chatId: overrides.chatId || 'chat-1',
    createdBy: overrides.createdBy || { _id: 'user-1', fullName: 'Caller', username: 'caller', profileImage: '' },
    type: overrides.type || 'voice',
    status: overrides.status || 'ringing',
    signalingVersion: overrides.signalingVersion || 0,
    startedAt: overrides.startedAt || null,
    endedAt: overrides.endedAt || null,
    createdAt: overrides.createdAt || new Date('2026-03-21T02:15:00.000Z'),
    updatedAt: overrides.updatedAt || new Date('2026-03-21T02:15:00.000Z'),
    participants: overrides.participants || [],
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
      return this;
    },
    toObject() {
      return {
        _id: this._id,
        chatId: this.chatId,
        createdBy: this.createdBy,
        type: this.type,
        status: this.status,
        signalingVersion: this.signalingVersion,
        startedAt: this.startedAt,
        endedAt: this.endedAt,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt,
        participants: this.participants.map((participant) => (
          participant.toObject ? participant.toObject() : { ...participant }
        )),
      };
    },
  };
}

function buildParticipant(userId, state = 'ringing') {
  return {
    userId,
    state,
    invitedAt: new Date('2026-03-21T02:15:00.000Z'),
    answeredAt: null,
    joinedAt: state === 'ringing' ? null : new Date('2026-03-21T02:16:00.000Z'),
    leftAt: null,
    toObject() {
      return {
        userId: this.userId,
        state: this.state,
        invitedAt: this.invitedAt,
        answeredAt: this.answeredAt,
        joinedAt: this.joinedAt,
        leftAt: this.leftAt,
      };
    },
  };
}

let originals;

test.beforeEach(() => {
  originals = {
    callFindOne: Call.findOne,
    callCreate: Call.create,
    callFindById: Call.findById,
    callCountDocuments: Call.countDocuments,
    ensureChatMember: chatService.ensureChatMember,
  };
});

test.afterEach(() => {
  Call.findOne = originals.callFindOne;
  Call.create = originals.callCreate;
  Call.findById = originals.callFindById;
  Call.countDocuments = originals.callCountDocuments;
  chatService.ensureChatMember = originals.ensureChatMember;
});

test('createCall creates a ringing call with all chat members as participants', async () => {
  chatService.ensureChatMember = async () => ({
    _id: 'chat-1',
    memberIds: ['user-1', 'user-2'],
  });
  Call.findOne = () => chainable(null);

  let createdDoc = null;
  Call.create = async (payload) => {
    createdDoc = buildCallDoc({
      _id: 'call-1',
      chatId: payload.chatId,
      createdBy: payload.createdBy,
      type: payload.type,
      status: payload.status,
      participants: payload.participants.map((participant) => ({
        ...participant,
        toObject() { return { ...this }; },
      })),
      startedAt: payload.startedAt,
    });
    return createdDoc;
  };
  Call.findById = () => chainable(createdDoc);

  const result = await callService.createCall('user-1', { chatId: 'chat-1', type: 'video' });

  assert.equal(result.status, 'ringing');
  assert.equal(result.type, 'video');
  assert.equal(result.participants.length, 2);
});

test('acceptCall transitions participant and call into connecting state', async () => {
  chatService.ensureChatMember = async () => ({ _id: 'chat-1' });
  const callDoc = buildCallDoc({
    participants: [
      buildParticipant({ _id: 'user-1', fullName: 'Caller', username: 'caller', profileImage: '' }, 'ringing'),
      buildParticipant({ _id: 'user-2', fullName: 'Receiver', username: 'receiver', profileImage: '' }, 'ringing'),
    ],
  });
  Call.findById = () => chainable(callDoc);

  const result = await callService.acceptCall('user-2', 'call-1');

  assert.equal(result.status, 'connecting');
  const receiver = result.participants.find((participant) => participant.userId === 'user-2');
  assert.equal(receiver.state, 'connecting');
});

test('relaySignal returns a frontend-friendly offer relay payload for authorized participants', async () => {
  chatService.ensureChatMember = async () => ({ _id: 'chat-1' });
  const callDoc = buildCallDoc({
    status: 'connecting',
    participants: [
      buildParticipant({ _id: 'user-1', fullName: 'Caller', username: 'caller', profileImage: '' }, 'connecting'),
      buildParticipant({ _id: 'user-2', fullName: 'Receiver', username: 'receiver', profileImage: '' }, 'connecting'),
    ],
  });
  Call.findById = () => chainable(callDoc);

  const result = await callService.relaySignal('user-1', 'call-1', {
    toUserId: 'user-2',
    type: 'offer',
    sdp: { type: 'offer', sdp: 'fake-sdp' },
    clientSignalId: 'signal-1',
  });

  assert.equal(result.signal.toUserId, 'user-2');
  assert.equal(result.signal.type, 'offer');
  assert.equal(result.call.id, 'call-1');
});

test('call socket relays offer events to the target user room', async () => {
  const events = new Map();
  const roomEmits = [];
  const joins = [];

  const fakeIo = {
    to(room) {
      return {
        emit(event, payload) {
          roomEmits.push({ room, event, payload });
        },
      };
    },
  };

  const fakeSocket = {
    user: { _id: 'user-1', fullName: 'Caller', username: 'caller' },
    on(event, handler) {
      events.set(event, handler);
    },
    emit() {},
    join(room) {
      joins.push(room);
    },
    leave() {},
  };

  const originalRelaySignal = callService.relaySignal;
  callService.relaySignal = async () => ({
    call: { id: 'call-1', participants: [{ userId: 'user-1' }, { userId: 'user-2' }] },
    signal: {
      callId: 'call-1',
      chatId: 'chat-1',
      fromUserId: 'user-1',
      toUserId: 'user-2',
      type: 'offer',
      sdp: { type: 'offer', sdp: 'fake-sdp' },
      candidate: null,
      clientSignalId: 'signal-1',
      sentAt: new Date(),
    },
  });

  try {
    registerCallSocket(fakeIo, fakeSocket);
    await new Promise((resolve, reject) => {
      events.get('call:signal:offer')({
        callId: 'call-1',
        toUserId: 'user-2',
        sdp: { type: 'offer', sdp: 'fake-sdp' },
        clientSignalId: 'signal-1',
      }, (response) => {
        try {
          assert.equal(response.success, true);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });

    assert.ok(roomEmits.some((entry) => entry.room === 'user:user-2' && entry.event === 'call:signal:offer'));
  } finally {
    callService.relaySignal = originalRelaySignal;
  }
});
