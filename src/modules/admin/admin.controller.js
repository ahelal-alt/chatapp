const ApiResponse = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./admin.service');

const getDashboardSummary = asyncHandler(async (req, res) => {
  const summary = await service.getDashboardSummary();
  res.json(new ApiResponse('Admin dashboard fetched successfully', summary));
});

const getAnalytics = asyncHandler(async (req, res) => {
  const analytics = await service.getAnalytics(req.query);
  res.json(new ApiResponse('Admin analytics fetched successfully', analytics));
});

const listUsers = asyncHandler(async (req, res) => {
  const result = await service.listUsers(req.query);
  res.json(new ApiResponse('Users fetched successfully', result.items, result.meta));
});

const getUserDetails = asyncHandler(async (req, res) => {
  const result = await service.getUserDetails(req.params.userId);
  res.json(new ApiResponse('User fetched successfully', result));
});

const listReports = asyncHandler(async (req, res) => {
  const result = await service.listReports(req.query);
  res.json(new ApiResponse('Reports fetched successfully', result.items, result.meta));
});

const getReportDetails = asyncHandler(async (req, res) => {
  const report = await service.getReportDetails(req.params.reportId);
  res.json(new ApiResponse('Report fetched successfully', report));
});

const reviewReport = asyncHandler(async (req, res) => {
  const report = await service.reviewReport(req.user._id, req.params.reportId, req.body);
  res.json(new ApiResponse('Report updated successfully', report));
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
  getDashboardSummary,
  getAnalytics,
  listUsers,
  getUserDetails,
  listReports,
  getReportDetails,
  reviewReport,
  suspendUser,
  activateUser,
  deleteMessage,
};
