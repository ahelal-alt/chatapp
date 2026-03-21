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

const joinCall = asyncHandler(async (req, res) => {
  const call = await service.joinCall(req.user._id, req.params.callId);
  res.json(new ApiResponse('Call joined successfully', call));
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
  joinCall,
  leaveCall,
  endCall,
};
