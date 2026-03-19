const ApiResponse = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./chat.service');

const openPrivateChat = asyncHandler(async (req, res) => {
  const chat = await service.openPrivateChat(req.user._id, req.params.userId);
  res.status(201).json(new ApiResponse('Private chat opened successfully', chat));
});

const listChats = asyncHandler(async (req, res) => {
  const result = await service.listChats(req.user._id, req.query);
  res.json(new ApiResponse('Chats fetched successfully', result.items, result.meta));
});

const getChatDetails = asyncHandler(async (req, res) => {
  const chat = await service.getChatDetails(req.user._id, req.params.chatId);
  res.json(new ApiResponse('Chat fetched successfully', chat));
});

const archiveChat = asyncHandler(async (req, res) => {
  const chat = await service.setChatFlag(req.user._id, req.params.chatId, { archivedAt: new Date() });
  res.json(new ApiResponse('Chat archived successfully', chat));
});

const unarchiveChat = asyncHandler(async (req, res) => {
  const chat = await service.setChatFlag(req.user._id, req.params.chatId, { archivedAt: null });
  res.json(new ApiResponse('Chat unarchived successfully', chat));
});

const muteChat = asyncHandler(async (req, res) => {
  const chat = await service.setChatFlag(req.user._id, req.params.chatId, {
    mutedUntil: req.body.mutedUntil || new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  res.json(new ApiResponse('Chat muted successfully', chat));
});

const unmuteChat = asyncHandler(async (req, res) => {
  const chat = await service.setChatFlag(req.user._id, req.params.chatId, { mutedUntil: null });
  res.json(new ApiResponse('Chat unmuted successfully', chat));
});

const pinChat = asyncHandler(async (req, res) => {
  const chat = await service.setChatFlag(req.user._id, req.params.chatId, { pinnedAt: new Date() });
  res.json(new ApiResponse('Chat pinned successfully', chat));
});

const unpinChat = asyncHandler(async (req, res) => {
  const chat = await service.setChatFlag(req.user._id, req.params.chatId, { pinnedAt: null });
  res.json(new ApiResponse('Chat unpinned successfully', chat));
});

const clearChat = asyncHandler(async (req, res) => {
  await service.clearChat(req.user._id, req.params.chatId);
  res.json(new ApiResponse('Chat cleared successfully'));
});

module.exports = {
  openPrivateChat,
  listChats,
  getChatDetails,
  archiveChat,
  unarchiveChat,
  muteChat,
  unmuteChat,
  pinChat,
  unpinChat,
  clearChat,
};

