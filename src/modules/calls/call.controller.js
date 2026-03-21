const ApiResponse = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./call.service');

const createCall = asyncHandler(async (req, res) => {
  const call = await service.createCall(req.user._id, req.body);
  res.status(201).json(new ApiResponse('Call created successfully', call));
});

const listCalls = asyncHandler(async (req, res) => {
  const result = await service.listCalls(req.user._id, req.query);
  res.json(new ApiResponse('Calls fetched successfully', result.items, result.meta));
});

const getCall = asyncHandler(async (req, res) => {
  const call = await service.getCall(req.user._id, req.params.callId);
  res.json(new ApiResponse('Call fetched successfully', call));
});

const acceptCall = asyncHandler(async (req, res) => {
  const call = await service.acceptCall(req.user._id, req.params.callId);
  res.json(new ApiResponse('Call accepted successfully', call));
});

const rejectCall = asyncHandler(async (req, res) => {
  const call = await service.rejectCall(req.user._id, req.params.callId);
  res.json(new ApiResponse('Call rejected successfully', call));
});

const joinCall = asyncHandler(async (req, res) => {
  const call = await service.joinCall(req.user._id, req.params.callId);
  res.json(new ApiResponse('Call joined successfully', call));
});

const updateParticipantState = asyncHandler(async (req, res) => {
  const call = await service.updateParticipantState(req.user._id, req.params.callId, req.body.state);
  res.json(new ApiResponse('Call participant state updated successfully', call));
});

const syncCall = asyncHandler(async (req, res) => {
  const call = await service.syncCall(req.user._id, req.params.callId);
  res.json(new ApiResponse('Call synced successfully', call));
});

const leaveCall = asyncHandler(async (req, res) => {
  const call = await service.leaveCall(req.user._id, req.params.callId);
  res.json(new ApiResponse('Call left successfully', call));
});

const endCall = asyncHandler(async (req, res) => {
  const call = await service.endCall(req.user._id, req.params.callId);
  res.json(new ApiResponse('Call ended successfully', call));
});

module.exports = {
  createCall,
  listCalls,
  getCall,
  acceptCall,
  rejectCall,
  joinCall,
  updateParticipantState,
  syncCall,
  leaveCall,
  endCall,
};
