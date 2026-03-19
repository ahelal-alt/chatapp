const ApiResponse = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./report.service');

const reportUser = asyncHandler(async (req, res) => {
  const report = await service.createUserReport(req.user._id, req.params.userId, req.body.reason);
  res.status(201).json(new ApiResponse('User reported successfully', report));
});

const reportMessage = asyncHandler(async (req, res) => {
  const report = await service.createMessageReport(req.user._id, req.params.messageId, req.body.reason);
  res.status(201).json(new ApiResponse('Message reported successfully', report));
});

module.exports = {
  reportUser,
  reportMessage,
};

