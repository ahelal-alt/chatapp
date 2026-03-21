const Call = require('./call.model');
const ApiError = require('../../utils/ApiError');
const { getPagination, buildPaginationMeta } = require('../../utils/pagination');
const { ensureChatMember } = require('../chats/chat.service');

async function createCall(userId, payload) {
  const chat = await ensureChatMember(payload.chatId, userId);
  const activeCall = await Call.findOne({
    chatId: chat._id,
    status: { $in: ['pending', 'active'] },
  });

  if (activeCall) {
    return activeCall;
  }

  return Call.create({
    chatId: chat._id,
    createdBy: userId,
    type: payload.type || 'voice',
    status: 'pending',
    participants: [{ userId, joinedAt: new Date() }],
    startedAt: new Date(),
  });
}

async function listCalls(userId, query) {
  const { page, limit, skip } = getPagination(query);
  const criteria = {
    'participants.userId': userId,
  };
  if (query.status) {
    criteria.status = query.status;
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
    items,
    meta: buildPaginationMeta({ page, limit, total }),
  };
}

async function getCall(userId, callId) {
  const call = await Call.findById(callId)
    .populate('createdBy', 'fullName username profileImage')
    .populate('participants.userId', 'fullName username profileImage');
  if (!call) {
    throw new ApiError(404, 'Call not found');
  }

  await ensureChatMember(call.chatId, userId);

  return call;
}

async function joinCall(userId, callId) {
  const call = await getCall(userId, callId);
  const participant = call.participants.find((item) => String(item.userId?._id || item.userId) === String(userId));
  if (!participant) {
    call.participants.push({ userId, joinedAt: new Date(), leftAt: null });
  } else {
    participant.joinedAt = participant.joinedAt || new Date();
    participant.leftAt = null;
  }
  call.status = 'active';
  call.startedAt = call.startedAt || new Date();
  await call.save();
  return call;
}

async function leaveCall(userId, callId) {
  const call = await getCall(userId, callId);
  const participant = call.participants.find((item) => String(item.userId?._id || item.userId) === String(userId));
  if (!participant) {
    throw new ApiError(404, 'Call participant not found');
  }
  participant.leftAt = new Date();

  const hasActiveParticipants = call.participants.some((item) => !item.leftAt && String(item.userId?._id || item.userId) !== String(userId));
  if (!hasActiveParticipants) {
    call.status = 'ended';
    call.endedAt = new Date();
  }

  await call.save();
  return call;
}

async function endCall(userId, callId) {
  const call = await getCall(userId, callId);
  if (String(call.createdBy?._id || call.createdBy) !== String(userId)) {
    throw new ApiError(403, 'Only the call creator can end this call');
  }

  call.status = 'ended';
  call.endedAt = new Date();
  call.participants = call.participants.map((participant) => ({
    ...participant.toObject ? participant.toObject() : participant,
    leftAt: participant.leftAt || new Date(),
  }));
  await call.save();
  return call;
}

module.exports = {
  createCall,
  listCalls,
  getCall,
  joinCall,
  leaveCall,
  endCall,
};
