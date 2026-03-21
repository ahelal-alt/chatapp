const ApiResponse = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./notification.service');

const listNotifications = asyncHandler(async (req, res) => {
  const result = await service.listNotifications(req.user._id, req.query);
  res.json(new ApiResponse('Notifications fetched successfully', result.items, result.meta));
});

const getNotificationDetails = asyncHandler(async (req, res) => {
  const notification = await service.getNotificationDetails(req.user._id, req.params.notificationId);
  res.json(new ApiResponse('Notification fetched successfully', notification));
});

const markRead = asyncHandler(async (req, res) => {
  const notification = await service.markRead(req.user._id, req.params.notificationId);
  res.json(new ApiResponse('Notification marked as read', notification));
});

const markAllRead = asyncHandler(async (req, res) => {
  await service.markAllRead(req.user._id);
  res.json(new ApiResponse('All notifications marked as read'));
});

module.exports = {
  listNotifications,
  getNotificationDetails,
  markRead,
  markAllRead,
};
