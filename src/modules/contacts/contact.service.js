const Contact = require('./contact.model');
const ContactRequest = require('./contactRequest.model');
const ApiError = require('../../utils/ApiError');
const { getPagination, buildPaginationMeta } = require('../../utils/pagination');
const { assertNotBlocked } = require('../../utils/blockCheck');
const notificationService = require('../notifications/notification.service');
const { ensureActiveUser } = require('../../utils/privacy');

async function ensureTargetUserExists(userId) {
  return ensureActiveUser(userId, 'Target user not found');
}

async function sendRequest(senderId, receiverId) {
  if (String(senderId) === String(receiverId)) {
    throw new ApiError(400, 'You cannot send a contact request to yourself');
  }

  await ensureTargetUserExists(receiverId);
  await assertNotBlocked(senderId, receiverId, 'Cannot send a contact request to a blocked user');

  const contact = await Contact.findOne({ userId: senderId, contactUserId: receiverId }).lean();
  if (contact) {
    throw new ApiError(409, 'This user is already in your contacts');
  }

  const existingPending = await ContactRequest.findOne({
    status: 'pending',
    $or: [
      { senderId, receiverId },
      { senderId: receiverId, receiverId: senderId },
    ],
  }).lean();

  if (existingPending) {
    throw new ApiError(409, 'A pending contact request already exists');
  }

  const request = await ContactRequest.create({
    senderId,
    receiverId,
    status: 'pending',
  });

  await notificationService.createNotification({
    userId: receiverId,
    type: 'contact_request_received',
    title: 'New contact request',
    body: 'You have received a new contact request',
    data: {
      requestId: request._id,
      senderId,
    },
  });

  return request;
}

async function getRequestForReceiver(requestId, receiverId) {
  const request = await ContactRequest.findById(requestId);

  if (!request) {
    throw new ApiError(404, 'Contact request not found');
  }

  if (String(request.receiverId) !== String(receiverId)) {
    throw new ApiError(403, 'You are not allowed to manage this request');
  }

  if (request.status !== 'pending') {
    throw new ApiError(400, 'This request is no longer pending');
  }

  return request;
}

async function acceptRequest(requestId, receiverId) {
  const request = await getRequestForReceiver(requestId, receiverId);
  await assertNotBlocked(request.senderId, request.receiverId, 'Cannot accept a blocked contact request');

  request.status = 'accepted';
  await request.save();

  await Contact.create([
    { userId: request.senderId, contactUserId: request.receiverId },
    { userId: request.receiverId, contactUserId: request.senderId },
  ]);

  await notificationService.createNotification({
    userId: request.senderId,
    type: 'contact_request_accepted',
    title: 'Contact request accepted',
    body: 'Your contact request was accepted',
    data: {
      requestId: request._id,
      receiverId,
    },
  });

  return request;
}

async function rejectRequest(requestId, receiverId) {
  const request = await getRequestForReceiver(requestId, receiverId);
  request.status = 'rejected';
  await request.save();
  return request;
}

async function cancelRequest(requestId, senderId) {
  const request = await ContactRequest.findById(requestId);

  if (!request) {
    throw new ApiError(404, 'Contact request not found');
  }

  if (String(request.senderId) !== String(senderId)) {
    throw new ApiError(403, 'You are not allowed to cancel this request');
  }

  if (request.status !== 'pending') {
    throw new ApiError(400, 'This request is no longer pending');
  }

  request.status = 'cancelled';
  await request.save();

  return request;
}

async function listIncoming(userId, query) {
  const { page, limit, skip } = getPagination(query);
  const criteria = { receiverId: userId, status: 'pending' };

  const [items, total] = await Promise.all([
    ContactRequest.find(criteria)
      .populate('senderId', 'fullName username profileImage')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    ContactRequest.countDocuments(criteria),
  ]);

  return {
    items,
    meta: buildPaginationMeta({ page, limit, total }),
  };
}

async function listOutgoing(userId, query) {
  const { page, limit, skip } = getPagination(query);
  const criteria = { senderId: userId, status: 'pending' };

  const [items, total] = await Promise.all([
    ContactRequest.find(criteria)
      .populate('receiverId', 'fullName username profileImage')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    ContactRequest.countDocuments(criteria),
  ]);

  return {
    items,
    meta: buildPaginationMeta({ page, limit, total }),
  };
}

async function listContacts(userId, query) {
  const { page, limit, skip } = getPagination(query);
  const criteria = { userId };

  const [items, total] = await Promise.all([
    Contact.find(criteria)
      .populate('contactUserId', 'fullName username profileImage statusMessage isOnline lastSeen')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Contact.countDocuments(criteria),
  ]);

  return {
    items,
    meta: buildPaginationMeta({ page, limit, total }),
  };
}

async function removeContact(userId, contactUserId) {
  await Contact.deleteMany({
    $or: [
      { userId, contactUserId },
      { userId: contactUserId, contactUserId: userId },
    ],
  });
}

async function favoriteContact(userId, contactUserId, isFavorite) {
  const contact = await Contact.findOneAndUpdate(
    { userId, contactUserId },
    { isFavorite },
    { new: true },
  );

  if (!contact) {
    throw new ApiError(404, 'Contact not found');
  }

  return contact;
}

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
};
