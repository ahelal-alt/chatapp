const ApiResponse = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./invite.service');

const listInvites = asyncHandler(async (req, res) => {
  const result = await service.listInvites(req.user._id, req.query);
  res.json(new ApiResponse('Invites fetched successfully', result.items, result.meta));
});

const createInvite = asyncHandler(async (req, res) => {
  const result = await service.createInvite(req.user._id, req.body);
  res.status(201).json(new ApiResponse('Invite created successfully', result.invite, result.devOnly || null));
});

const getInviteDetails = asyncHandler(async (req, res) => {
  const invite = await service.getInviteDetails(req.user._id, req.params.inviteId);
  res.json(new ApiResponse('Invite fetched successfully', invite));
});

const resendInvite = asyncHandler(async (req, res) => {
  const result = await service.resendInvite(req.user._id, req.params.inviteId);
  res.json(new ApiResponse('Invite resent successfully', result.invite, result.devOnly || null));
});

const revokeInvite = asyncHandler(async (req, res) => {
  const result = await service.revokeInvite(req.user._id, req.params.inviteId);
  res.json(new ApiResponse(result.message));
});

const acceptInvite = asyncHandler(async (req, res) => {
  const invite = await service.acceptInvite(req.user._id, req.body);
  res.json(new ApiResponse('Invite accepted successfully', invite));
});

module.exports = {
  listInvites,
  createInvite,
  getInviteDetails,
  resendInvite,
  revokeInvite,
  acceptInvite,
};
