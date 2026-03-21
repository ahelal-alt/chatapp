const ApiResponse = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./group.service');

const listGroups = asyncHandler(async (req, res) => {
  const result = await service.listGroups(req.user._id, req.query);
  res.json(new ApiResponse('Groups fetched successfully', result.items, result.meta));
});

const createGroup = asyncHandler(async (req, res) => {
  const group = await service.createGroup(req.user._id, req.body);
  res.status(201).json(new ApiResponse('Group created successfully', group));
});

const getGroup = asyncHandler(async (req, res) => {
  const group = await service.getGroupDetails(req.params.groupId, req.user._id);
  res.json(new ApiResponse('Group fetched successfully', group));
});

const updateGroup = asyncHandler(async (req, res) => {
  const group = await service.updateGroup(req.params.groupId, req.user._id, req.body);
  res.json(new ApiResponse('Group updated successfully', group));
});

const deleteGroup = asyncHandler(async (req, res) => {
  await service.deleteGroup(req.params.groupId, req.user._id);
  res.json(new ApiResponse('Group deleted successfully'));
});

const addMembers = asyncHandler(async (req, res) => {
  const group = await service.addMembers(req.params.groupId, req.user._id, req.body.userIds);
  res.json(new ApiResponse('Members added successfully', group));
});

const removeMember = asyncHandler(async (req, res) => {
  await service.removeMember(req.params.groupId, req.user._id, req.params.userId);
  res.json(new ApiResponse('Member removed successfully'));
});

const promoteMember = asyncHandler(async (req, res) => {
  const member = await service.promoteMember(req.params.groupId, req.user._id, req.params.userId);
  res.json(new ApiResponse('Member promoted successfully', member));
});

const demoteMember = asyncHandler(async (req, res) => {
  const member = await service.demoteMember(req.params.groupId, req.user._id, req.params.userId);
  res.json(new ApiResponse('Member demoted successfully', member));
});

const transferOwnership = asyncHandler(async (req, res) => {
  const group = await service.transferOwnership(req.params.groupId, req.user._id, req.params.userId);
  res.json(new ApiResponse('Ownership transferred successfully', group));
});

const leaveGroup = asyncHandler(async (req, res) => {
  await service.leaveGroup(req.params.groupId, req.user._id);
  res.json(new ApiResponse('You left the group successfully'));
});

const generateInviteCode = asyncHandler(async (req, res) => {
  const group = await service.regenerateInviteCode(req.params.groupId, req.user._id);
  res.json(new ApiResponse('Invite code generated successfully', { inviteCode: group.inviteCode }));
});

const joinByInviteCode = asyncHandler(async (req, res) => {
  const group = await service.joinByInviteCode(req.params.inviteCode, req.user._id);
  res.json(new ApiResponse('Joined group successfully', group));
});

const submitJoinRequest = asyncHandler(async (req, res) => {
  const joinRequest = await service.submitJoinRequest(req.params.groupId, req.user._id, req.body);
  res.status(201).json(new ApiResponse('Join request created successfully', joinRequest));
});

const listJoinRequests = asyncHandler(async (req, res) => {
  const result = await service.listJoinRequests(req.params.groupId, req.user._id, req.query);
  res.json(new ApiResponse('Join requests fetched successfully', result.items, result.meta));
});

const approveJoinRequest = asyncHandler(async (req, res) => {
  const joinRequest = await service.reviewJoinRequest(req.params.groupId, req.params.requestId, req.user._id, 'approved');
  res.json(new ApiResponse('Join request approved successfully', joinRequest));
});

const rejectJoinRequest = asyncHandler(async (req, res) => {
  const joinRequest = await service.reviewJoinRequest(req.params.groupId, req.params.requestId, req.user._id, 'rejected');
  res.json(new ApiResponse('Join request rejected successfully', joinRequest));
});

module.exports = {
  listGroups,
  createGroup,
  getGroup,
  updateGroup,
  deleteGroup,
  addMembers,
  removeMember,
  promoteMember,
  demoteMember,
  transferOwnership,
  leaveGroup,
  generateInviteCode,
  joinByInviteCode,
  submitJoinRequest,
  listJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
};
