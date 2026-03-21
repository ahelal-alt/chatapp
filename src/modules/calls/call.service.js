const Call = require('./call.model');
const ApiError = require('../../utils/ApiError');
const { getPagination, buildPaginationMeta } = require('../../utils/pagination');
const chatService = require('../chats/chat.service');

const ACTIVE_CALL_STATUSES = ['ringing', 'connecting', 'connected'];
const PARTICIPANT_ACTIVE_STATES = ['ringing', 'connecting', 'connected'];

function toId(value) {
  return String(value?._id || value || '');
}

function serializeParticipant(participant) {
  const user = participant.userId || null;
  return {
    userId: toId(user),
    user: user && typeof user === 'object' ? {
      id: toId(user),
      fullName: user.fullName || '',
      username: user.username || '',
      profileImage: user.profileImage || '',
    } : null,
    state: participant.state,
    invitedAt: participant.invitedAt || null,
    answeredAt: participant.answeredAt || null,
    joinedAt: participant.joinedAt || null,
    leftAt: participant.leftAt || null,
  };
}

function serializeCall(call) {
  const plain = call?.toObject ? call.toObject() : call;
  const legacyStatus = plain.status === 'ringing'
    ? 'pending'
    : ['connecting', 'connected'].includes(plain.status)
      ? 'active'
      : plain.status;
  return {
    id: toId(plain),
    chatId: toId(plain.chatId),
    createdBy: toId(plain.createdBy),
    createdByUser: plain.createdBy && typeof plain.createdBy === 'object' ? {
      id: toId(plain.createdBy),
      fullName: plain.createdBy.fullName || '',
      username: plain.createdBy.username || '',
      profileImage: plain.createdBy.profileImage || '',
    } : null,
    type: plain.type,
    status: plain.status,
    legacyStatus,
    signalingVersion: plain.signalingVersion || 0,
    startedAt: plain.startedAt || null,
    endedAt: plain.endedAt || null,
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
    participants: Array.isArray(plain.participants) ? plain.participants.map(serializeParticipant) : [],
  };
}

async function getHydratedCall(callId) {
  return Call.findById(callId)
    .populate('createdBy', 'fullName username profileImage')
    .populate('participants.userId', 'fullName username profileImage');
}

function getParticipant(call, userId) {
  return call.participants.find((item) => toId(item.userId) === String(userId));
}

function getOtherParticipantIds(call, userId) {
  return call.participants
    .map((item) => toId(item.userId))
    .filter((participantUserId) => participantUserId && participantUserId !== String(userId));
}

function hasConnectedPeer(call, excludingUserId = null) {
  return call.participants.some((item) => {
    if (excludingUserId && toId(item.userId) === String(excludingUserId)) {
      return false;
    }
    return ['connecting', 'connected'].includes(item.state) && !item.leftAt;
  });
}

function hasAnyLiveParticipant(call, excludingUserId = null) {
  return call.participants.some((item) => {
    if (excludingUserId && toId(item.userId) === String(excludingUserId)) {
      return false;
    }
    return PARTICIPANT_ACTIVE_STATES.includes(item.state) && !item.leftAt;
  });
}

function computeCallStatus(call) {
  const participantStates = call.participants.map((participant) => participant.state);

  if (participantStates.some((state) => state === 'connected')) {
    return 'connected';
  }
  if (participantStates.some((state) => state === 'connecting')) {
    return 'connecting';
  }
  if (participantStates.some((state) => state === 'ringing')) {
    return 'ringing';
  }
  if (participantStates.every((state) => ['declined', 'missed'].includes(state))) {
    return 'missed';
  }
  if (participantStates.every((state) => ['declined', 'left', 'ended', 'missed'].includes(state))) {
    return 'ended';
  }
  if (participantStates.some((state) => state === 'declined')) {
    return 'declined';
  }
  return call.endedAt ? 'ended' : 'ringing';
}

async function saveAndHydrate(call) {
  call.signalingVersion = Number(call.signalingVersion || 0) + 1;
  await call.save();
  const hydrated = await getHydratedCall(call._id);
  return serializeCall(hydrated);
}

async function ensureCallParticipant(callId, userId) {
  const call = await getHydratedCall(callId);
  if (!call) {
    throw new ApiError(404, 'Call not found');
  }

  await chatService.ensureChatMember(call.chatId, userId);
  const participant = getParticipant(call, userId);
  if (!participant) {
    throw new ApiError(403, 'You are not a participant in this call');
  }

  return { call, participant };
}

async function createCall(userId, payload) {
  const chat = await chatService.ensureChatMember(payload.chatId, userId);
  const activeCall = await Call.findOne({
    chatId: chat._id,
    status: { $in: ACTIVE_CALL_STATUSES },
  })
    .populate('createdBy', 'fullName username profileImage')
    .populate('participants.userId', 'fullName username profileImage');

  if (activeCall) {
    return serializeCall(activeCall);
  }

  const now = new Date();
  const call = await Call.create({
    chatId: chat._id,
    createdBy: userId,
    type: payload.type || 'voice',
    status: 'ringing',
    participants: (chat.memberIds || []).map((memberId) => ({
      userId: memberId,
      state: 'ringing',
      invitedAt: now,
      answeredAt: String(memberId) === String(userId) ? now : null,
      joinedAt: String(memberId) === String(userId) ? now : null,
      leftAt: null,
    })),
    startedAt: null,
  });

  const hydrated = await getHydratedCall(call._id);
  return serializeCall(hydrated);
}

async function listCalls(userId, query) {
  const { page, limit, skip } = getPagination(query);
  const criteria = {
    'participants.userId': userId,
  };
  if (query.status) {
    if (query.status === 'pending') {
      criteria.status = 'ringing';
    } else if (query.status === 'active') {
      criteria.status = { $in: ['connecting', 'connected'] };
    } else {
      criteria.status = query.status;
    }
  }

  const [items, total] = await Promise.all([
    Call.find(criteria)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'fullName username profileImage')
      .populate('participants.userId', 'fullName username profileImage'),
    Call.countDocuments(criteria),
  ]);

  return {
    items: items.map(serializeCall),
    meta: buildPaginationMeta({ page, limit, total }),
  };
}

async function getCall(userId, callId) {
  const { call } = await ensureCallParticipant(callId, userId);
  return serializeCall(call);
}

async function acceptCall(userId, callId) {
  const { call, participant } = await ensureCallParticipant(callId, userId);
  if (['ended', 'missed'].includes(call.status)) {
    throw new ApiError(409, 'This call is no longer available');
  }

  participant.state = 'connecting';
  participant.answeredAt = participant.answeredAt || new Date();
  participant.joinedAt = participant.joinedAt || new Date();
  participant.leftAt = null;
  call.status = 'connecting';
  call.startedAt = call.startedAt || new Date();

  return saveAndHydrate(call);
}

async function rejectCall(userId, callId) {
  const { call, participant } = await ensureCallParticipant(callId, userId);
  if (['ended', 'missed'].includes(call.status)) {
    return serializeCall(call);
  }

  participant.state = 'declined';
  participant.answeredAt = participant.answeredAt || new Date();
  participant.leftAt = participant.leftAt || new Date();

  if (!hasAnyLiveParticipant(call, userId) && !hasConnectedPeer(call)) {
    call.status = 'missed';
    call.endedAt = new Date();
  } else {
    call.status = computeCallStatus(call);
  }

  return saveAndHydrate(call);
}

async function joinCall(userId, callId) {
  const { call, participant } = await ensureCallParticipant(callId, userId);
  if (['ended', 'missed'].includes(call.status)) {
    throw new ApiError(409, 'This call has already ended');
  }

  participant.state = participant.state === 'connected' ? 'connected' : 'connecting';
  participant.answeredAt = participant.answeredAt || new Date();
  participant.joinedAt = participant.joinedAt || new Date();
  participant.leftAt = null;
  call.status = participant.state === 'connected' ? 'connected' : 'connecting';
  call.startedAt = call.startedAt || new Date();

  return saveAndHydrate(call);
}

async function updateParticipantState(userId, callId, state) {
  const { call, participant } = await ensureCallParticipant(callId, userId);
  if (['ended', 'missed'].includes(call.status)) {
    throw new ApiError(409, 'This call has already ended');
  }

  participant.state = state;
  if (['connecting', 'connected'].includes(state)) {
    participant.answeredAt = participant.answeredAt || new Date();
    participant.joinedAt = participant.joinedAt || new Date();
    participant.leftAt = null;
    call.startedAt = call.startedAt || new Date();
  }

  call.status = computeCallStatus(call);

  return saveAndHydrate(call);
}

async function leaveCall(userId, callId) {
  const { call, participant } = await ensureCallParticipant(callId, userId);
  participant.leftAt = new Date();
  participant.state = call.status === 'ringing' ? 'missed' : 'left';

  if (!hasAnyLiveParticipant(call, userId)) {
    call.status = call.startedAt ? 'ended' : 'missed';
    call.endedAt = new Date();

    call.participants.forEach((item) => {
      if (!item.leftAt) {
        item.leftAt = new Date();
      }
      if (item.state === 'ringing') {
        item.state = 'missed';
      } else if (['connecting', 'connected'].includes(item.state)) {
        item.state = 'ended';
      }
    });
  } else {
    call.status = computeCallStatus(call);
  }

  return saveAndHydrate(call);
}

async function endCall(userId, callId) {
  const { call } = await ensureCallParticipant(callId, userId);
  if (toId(call.createdBy) !== String(userId)) {
    throw new ApiError(403, 'Only the call creator can end this call');
  }

  const endedAt = new Date();
  call.endedAt = endedAt;
  call.status = call.startedAt ? 'ended' : 'missed';
  call.participants = call.participants.map((participant) => {
    const plain = participant.toObject ? participant.toObject() : participant;
    if (plain.state === 'ringing') {
      plain.state = 'missed';
    } else {
      plain.state = 'ended';
    }
    plain.leftAt = plain.leftAt || endedAt;
    return plain;
  });

  return saveAndHydrate(call);
}

async function relaySignal(userId, callId, payload) {
  const { call, participant } = await ensureCallParticipant(callId, userId);
  if (['ended', 'missed'].includes(call.status)) {
    throw new ApiError(409, 'This call is no longer active');
  }

  if (!payload.toUserId) {
    throw new ApiError(400, 'Signal target is required');
  }

  const target = getParticipant(call, payload.toUserId);
  if (!target) {
    throw new ApiError(404, 'Signal target is not part of this call');
  }

  participant.answeredAt = participant.answeredAt || new Date();
  participant.joinedAt = participant.joinedAt || new Date();
  participant.leftAt = null;
  if (participant.state === 'ringing') {
    participant.state = 'connecting';
  }
  call.status = computeCallStatus(call);
  call.signalingVersion = Number(call.signalingVersion || 0) + 1;

  await call.save();

  return {
    call: serializeCall(call),
    signal: {
      callId: toId(call),
      chatId: toId(call.chatId),
      fromUserId: String(userId),
      toUserId: String(payload.toUserId),
      type: payload.type,
      sdp: payload.sdp || null,
      candidate: payload.candidate || null,
      clientSignalId: payload.clientSignalId || '',
      sentAt: new Date(),
    },
  };
}

async function syncCall(userId, callId) {
  const { call } = await ensureCallParticipant(callId, userId);
  return serializeCall(call);
}

module.exports = {
  createCall,
  listCalls,
  getCall,
  acceptCall,
  rejectCall,
  joinCall,
  updateParticipantState,
  leaveCall,
  endCall,
  relaySignal,
  syncCall,
};
