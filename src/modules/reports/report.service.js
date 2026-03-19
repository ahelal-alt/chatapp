const Report = require('./report.model');
const User = require('../users/user.model');
const Message = require('../messages/message.model');
const ApiError = require('../../utils/ApiError');

async function createUserReport(reporterUserId, userId, reason) {
  if (String(reporterUserId) === String(userId)) {
    throw new ApiError(400, 'You cannot report yourself');
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  return Report.create({
    reporterUserId,
    targetUserId: userId,
    reason,
  });
}

async function createMessageReport(reporterUserId, messageId, reason) {
  const message = await Message.findById(messageId);
  if (!message) {
    throw new ApiError(404, 'Message not found');
  }

  return Report.create({
    reporterUserId,
    targetMessageId: messageId,
    reason,
  });
}

module.exports = {
  createUserReport,
  createMessageReport,
};

