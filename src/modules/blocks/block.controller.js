const ApiResponse = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./block.service');

const blockUser = asyncHandler(async (req, res) => {
  const block = await service.blockUser(req.user._id, req.params.userId);
  res.status(201).json(new ApiResponse('User blocked successfully', block));
});

const unblockUser = asyncHandler(async (req, res) => {
  await service.unblockUser(req.user._id, req.params.userId);
  res.json(new ApiResponse('User unblocked successfully'));
});

const listBlockedUsers = asyncHandler(async (req, res) => {
  const result = await service.listBlockedUsers(req.user._id, req.query);
  res.json(new ApiResponse('Blocked users fetched successfully', result.items, result.meta));
});

module.exports = {
  blockUser,
  unblockUser,
  listBlockedUsers,
};

