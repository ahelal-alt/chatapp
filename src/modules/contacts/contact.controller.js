const ApiResponse = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./contact.service');

const sendRequest = asyncHandler(async (req, res) => {
  const request = await service.sendRequest(req.user._id, req.body.receiverId);
  res.status(201).json(new ApiResponse('Contact request sent successfully', request));
});

const acceptRequest = asyncHandler(async (req, res) => {
  const request = await service.acceptRequest(req.params.requestId, req.user._id);
  res.json(new ApiResponse('Contact request accepted successfully', request));
});

const rejectRequest = asyncHandler(async (req, res) => {
  const request = await service.rejectRequest(req.params.requestId, req.user._id);
  res.json(new ApiResponse('Contact request rejected successfully', request));
});

const cancelRequest = asyncHandler(async (req, res) => {
  const request = await service.cancelRequest(req.params.requestId, req.user._id);
  res.json(new ApiResponse('Contact request cancelled successfully', request));
});

const listIncoming = asyncHandler(async (req, res) => {
  const result = await service.listIncoming(req.user._id, req.query);
  res.json(new ApiResponse('Incoming contact requests fetched successfully', result.items, result.meta));
});

const listOutgoing = asyncHandler(async (req, res) => {
  const result = await service.listOutgoing(req.user._id, req.query);
  res.json(new ApiResponse('Outgoing contact requests fetched successfully', result.items, result.meta));
});

const listContacts = asyncHandler(async (req, res) => {
  const result = await service.listContacts(req.user._id, req.query);
  res.json(new ApiResponse('Contacts fetched successfully', result.items, result.meta));
});

const removeContact = asyncHandler(async (req, res) => {
  await service.removeContact(req.user._id, req.params.contactUserId);
  res.json(new ApiResponse('Contact removed successfully'));
});

const favoriteContact = asyncHandler(async (req, res) => {
  const contact = await service.favoriteContact(req.user._id, req.params.contactUserId, true);
  res.json(new ApiResponse('Contact marked as favorite', contact));
});

const unfavoriteContact = asyncHandler(async (req, res) => {
  const contact = await service.favoriteContact(req.user._id, req.params.contactUserId, false);
  res.json(new ApiResponse('Contact removed from favorites', contact));
});

const muteContact = asyncHandler(async (req, res) => {
  const contact = await service.muteContact(req.user._id, req.params.contactUserId, req.body.mutedUntil);
  res.json(new ApiResponse('Contact muted successfully', contact));
});

const unmuteContact = asyncHandler(async (req, res) => {
  const contact = await service.unmuteContact(req.user._id, req.params.contactUserId);
  res.json(new ApiResponse('Contact unmuted successfully', contact));
});

const listRecentContacts = asyncHandler(async (req, res) => {
  const result = await service.listRecentContacts(req.user._id, req.query);
  res.json(new ApiResponse('Recent contacts fetched successfully', result.items, result.meta));
});

module.exports = {
  sendRequest,
  acceptRequest,
  rejectRequest,
  cancelRequest,
  listIncoming,
  listOutgoing,
  listContacts,
  removeContact,
  favoriteContact,
  unfavoriteContact,
  muteContact,
  unmuteContact,
  listRecentContacts,
};
