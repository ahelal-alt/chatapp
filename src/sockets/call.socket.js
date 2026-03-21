const callService = require('../modules/calls/call.service');

function callRoom(callId) {
  return `call:${callId}`;
}

async function safeSocketHandler(socket, callback, responder) {
  try {
    const result = await callback();
    if (responder) {
      responder({ success: true, data: result });
    }
  } catch (error) {
    if (responder) {
      responder({ success: false, message: error.message });
      return;
    }

    socket.emit('socket:error', {
      message: error.message || 'Socket action failed',
    });
  }
}

function getParticipantIds(call) {
  return (call.participants || [])
    .map((participant) => String(participant.userId))
    .filter(Boolean);
}

function emitCallSnapshot(io, eventName, call, extra = {}) {
  const payload = {
    call,
    ...extra,
  };

  io.to(callRoom(call.id)).emit(eventName, payload);
  for (const participantUserId of getParticipantIds(call)) {
    io.to(`user:${participantUserId}`).emit(eventName, payload);
  }
}

async function joinCallRoom(socket, callId) {
  const call = await callService.syncCall(socket.user._id, callId);
  socket.join(callRoom(call.id));
  return call;
}

function registerCallSocket(io, socket) {
  socket.on('call:create', (payload = {}, callback) => safeSocketHandler(
    socket,
    async () => {
      const call = await callService.createCall(socket.user._id, payload);
      socket.join(callRoom(call.id));
      emitCallSnapshot(io, 'call:ringing', call, {
        initiatorUserId: String(socket.user._id),
      });
      return call;
    },
    callback,
  ));

  socket.on('call:sync', ({ callId } = {}, callback) => safeSocketHandler(
    socket,
    async () => joinCallRoom(socket, callId),
    callback,
  ));

  socket.on('call:accept', ({ callId } = {}, callback) => safeSocketHandler(
    socket,
    async () => {
      socket.join(callRoom(callId));
      const call = await callService.acceptCall(socket.user._id, callId);
      emitCallSnapshot(io, 'call:accepted', call, {
        participantUserId: String(socket.user._id),
      });
      return call;
    },
    callback,
  ));

  socket.on('call:reject', ({ callId } = {}, callback) => safeSocketHandler(
    socket,
    async () => {
      const call = await callService.rejectCall(socket.user._id, callId);
      emitCallSnapshot(io, call.status === 'missed' ? 'call:missed' : 'call:rejected', call, {
        participantUserId: String(socket.user._id),
      });
      return call;
    },
    callback,
  ));

  socket.on('call:join', ({ callId } = {}, callback) => safeSocketHandler(
    socket,
    async () => {
      socket.join(callRoom(callId));
      const call = await callService.joinCall(socket.user._id, callId);
      emitCallSnapshot(io, 'call:joined', call, {
        participantUserId: String(socket.user._id),
      });
      return call;
    },
    callback,
  ));

  socket.on('call:state', ({ callId, state } = {}, callback) => safeSocketHandler(
    socket,
    async () => {
      const call = await callService.updateParticipantState(socket.user._id, callId, state);
      emitCallSnapshot(io, 'call:state', call, {
        participantUserId: String(socket.user._id),
        state,
      });
      return call;
    },
    callback,
  ));

  socket.on('call:leave', ({ callId } = {}, callback) => safeSocketHandler(
    socket,
    async () => {
      const call = await callService.leaveCall(socket.user._id, callId);
      socket.leave(callRoom(callId));
      emitCallSnapshot(io, call.status === 'missed' ? 'call:missed' : 'call:left', call, {
        participantUserId: String(socket.user._id),
      });
      return call;
    },
    callback,
  ));

  socket.on('call:end', ({ callId } = {}, callback) => safeSocketHandler(
    socket,
    async () => {
      const call = await callService.endCall(socket.user._id, callId);
      emitCallSnapshot(io, call.status === 'missed' ? 'call:missed' : 'call:ended', call, {
        endedByUserId: String(socket.user._id),
      });
      return call;
    },
    callback,
  ));

  const relaySignal = (signalType) => socket.on(`call:signal:${signalType}`, (payload = {}, callback) => safeSocketHandler(
    socket,
    async () => {
      const result = await callService.relaySignal(socket.user._id, payload.callId, {
        ...payload,
        type: signalType,
      });
      io.to(`user:${result.signal.toUserId}`).emit(`call:signal:${signalType}`, result.signal);
      return result.call;
    },
    callback,
  ));

  relaySignal('offer');
  relaySignal('answer');
  relaySignal('ice-candidate');
}

module.exports = {
  registerCallSocket,
};
