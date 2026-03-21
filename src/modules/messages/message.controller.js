const ApiResponse = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./message.service');

const sendMessage = asyncHandler(async (req, res) => {
  const message = await service.createMessage(req.user._id, req.body);
  res.status(201).json(new ApiResponse('Message sent successfully', message));
});

const listMessages = asyncHandler(async (req, res) => {
  const result = await service.listMessages(req.user._id, req.params.chatId, req.query);
  res.json(new ApiResponse('Messages fetched successfully', result.items, result.meta));
});

const searchMessages = asyncHandler(async (req, res) => {
  const result = await service.searchMessages(req.user._id, req.params.chatId, req.query);
  res.json(new ApiResponse('Messages searched successfully', result.items, result.meta));
});

const listPinnedMessages = asyncHandler(async (req, res) => {
  const result = await service.listPinnedMessages(req.user._id, req.params.chatId, req.query);
  res.json(new ApiResponse('Pinned messages fetched successfully', result.items, result.meta));
});

const listSharedFiles = asyncHandler(async (req, res) => {
  const result = await service.listSharedFiles(req.user._id, {
    ...req.query,
    ...(req.params.chatId ? { chatId: req.params.chatId } : {}),
  });
  res.json(new ApiResponse('Shared files fetched successfully', result.items, result.meta));
});

const getMessage = asyncHandler(async (req, res) => {
  const message = await service.getMessageById(req.user._id, req.params.messageId);
  res.json(new ApiResponse('Message fetched successfully', message));
});

const getMediaDetails = asyncHandler(async (req, res) => {
  const media = await service.getMediaDetails(req.user._id, req.params.messageId);
  res.json(new ApiResponse('Media fetched successfully', media));
});

const editMessage = asyncHandler(async (req, res) => {
  const message = await service.editMessage(req.user._id, req.params.messageId, req.body.text);
  res.json(new ApiResponse('Message updated successfully', message));
});

const pinMessage = asyncHandler(async (req, res) => {
  const message = await service.pinMessage(req.user._id, req.params.messageId);
  res.json(new ApiResponse('Message pinned successfully', message));
});

const unpinMessage = asyncHandler(async (req, res) => {
  const message = await service.unpinMessage(req.user._id, req.params.messageId);
  res.json(new ApiResponse('Message unpinned successfully', message));
});

const deleteMessage = asyncHandler(async (req, res) => {
  await service.deleteMessageForEveryone(req.user._id, req.params.messageId);
  res.json(new ApiResponse('Message deleted for everyone'));
});

const deleteMessageForMe = asyncHandler(async (req, res) => {
  await service.deleteMessageForMe(req.user._id, req.params.messageId);
  res.json(new ApiResponse('Message deleted for you'));
});

const replyToMessage = asyncHandler(async (req, res) => {
  const message = await service.replyToMessage(req.user._id, req.params.messageId, req.body);
  res.status(201).json(new ApiResponse('Reply sent successfully', message));
});

const forwardMessage = asyncHandler(async (req, res) => {
  const message = await service.forwardMessage(req.user._id, req.params.messageId, req.body.chatId);
  res.status(201).json(new ApiResponse('Message forwarded successfully', message));
});

const addReaction = asyncHandler(async (req, res) => {
  const reactions = await service.addReaction(req.user._id, req.params.messageId, req.body.emoji);
  res.json(new ApiResponse('Reaction saved successfully', reactions));
});

const removeReaction = asyncHandler(async (req, res) => {
  const reactions = await service.removeReaction(req.user._id, req.params.messageId);
  res.json(new ApiResponse('Reaction removed successfully', reactions));
});

const markSeen = asyncHandler(async (req, res) => {
  const message = await service.markSeen(req.user._id, req.params.messageId);
  res.json(new ApiResponse('Message marked as seen', message));
});

const markDelivered = asyncHandler(async (req, res) => {
  const message = await service.markDelivered(req.user._id, req.params.messageId);
  res.json(new ApiResponse('Message marked as delivered', message));
});

module.exports = {
  sendMessage,
  listMessages,
  searchMessages,
  listPinnedMessages,
  listSharedFiles,
  getMessage,
  getMediaDetails,
  editMessage,
  pinMessage,
  unpinMessage,
  deleteMessage,
  deleteMessageForMe,
  replyToMessage,
  forwardMessage,
  addReaction,
  removeReaction,
  markSeen,
  markDelivered,
};
