const ApiResponse = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./admin.service');

const listUsers = asyncHandler(async (req, res) => {
  const result = await service.listUsers(req.query);
  res.json(new ApiResponse('Users fetched successfully', result.items, result.meta));
});

const listReports = asyncHandler(async (req, res) => {
  const result = await service.listReports(req.query);
  res.json(new ApiResponse('Reports fetched successfully', result.items, result.meta));
});

const suspendUser = asyncHandler(async (req, res) => {
  const user = await service.setUserStatus(req.user._id, req.params.userId, false);
  res.json(new ApiResponse('User suspended successfully', user));
});

const activateUser = asyncHandler(async (req, res) => {
  const user = await service.setUserStatus(req.user._id, req.params.userId, true);
  res.json(new ApiResponse('User activated successfully', user));
});

const deleteMessage = asyncHandler(async (req, res) => {
  await service.deleteMessage(req.user._id, req.params.messageId);
  res.json(new ApiResponse('Message deleted successfully'));
});

module.exports = {
  listUsers,
  listReports,
  suspendUser,
  activateUser,
  deleteMessage,
};

