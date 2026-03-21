const ApiResponse = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./invite.service');

function getRequestMeta(req) {
  return {
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || '',
    userId: req.user?._id ? String(req.user._id) : '',
  };
}

const listInvites = asyncHandler(async (req, res) => {
  const result = await service.listInvites(req.user._id, req.query);
  res.json(new ApiResponse('Invites fetched successfully', result.items, result.meta));
});

const createInvite = asyncHandler(async (req, res) => {
  const result = await service.createInvite(req.user._id, req.body);
  res.status(201).json(new ApiResponse('Invite created successfully', {
    invite: result.invite,
    inviteUrl: result.inviteUrl,
    emailDelivery: result.emailDelivery,
    ...(result.devOnly ? { devOnly: result.devOnly } : {}),
  }));
});

const getInviteDetails = asyncHandler(async (req, res) => {
  const invite = await service.getInviteDetails(req.user._id, req.params.inviteId);
  res.json(new ApiResponse('Invite fetched successfully', invite));
});

const resendInvite = asyncHandler(async (req, res) => {
  const result = await service.resendInvite(req.user._id, req.params.inviteId);
  res.json(new ApiResponse('Invite resent successfully', {
    invite: result.invite,
    inviteUrl: result.inviteUrl,
    emailDelivery: result.emailDelivery,
    ...(result.devOnly ? { devOnly: result.devOnly } : {}),
  }));
});

const revokeInvite = asyncHandler(async (req, res) => {
  const result = await service.revokeInvite(req.user._id, req.params.inviteId);
  res.json(new ApiResponse(result.message));
});

const acceptInvite = asyncHandler(async (req, res) => {
  const invite = await service.acceptInvite(req.user._id, req.body, getRequestMeta(req));
  res.json(new ApiResponse('Invite accepted successfully', invite));
});

const getPublicInvite = asyncHandler(async (req, res) => {
  const invite = await service.getPublicInvite(req.params.token, req.user || null);
  res.json(new ApiResponse('Invite fetched successfully', invite));
});

const registerFromPublicInvite = asyncHandler(async (req, res) => {
  const result = await service.registerFromPublicInvite(req.params.token, req.body, getRequestMeta(req));
  res.status(201).json(new ApiResponse('Invite registration completed successfully', result));
});

const loginFromPublicInvite = asyncHandler(async (req, res) => {
  const result = await service.loginFromPublicInvite(req.params.token, req.body, getRequestMeta(req));
  res.json(new ApiResponse('Invite sign-in completed successfully', result));
});

const acceptPublicInvite = asyncHandler(async (req, res) => {
  const result = await service.acceptPublicInvite(req.params.token, req.user?._id || null, getRequestMeta(req));
  res.json(new ApiResponse(
    result.accepted ? 'Invite accepted successfully' : 'Invite requires account access',
    result,
  ));
});

module.exports = {
  listInvites,
  createInvite,
  getInviteDetails,
  resendInvite,
  revokeInvite,
  acceptInvite,
  getPublicInvite,
  registerFromPublicInvite,
  loginFromPublicInvite,
  acceptPublicInvite,
};
