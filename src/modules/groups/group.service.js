const { v4: uuid } = require('uuid');
const Group = require('./group.model');
const GroupMember = require('./groupMember.model');
const Chat = require('../chats/chat.model');
const Message = require('../messages/message.model');
const notificationService = require('../notifications/notification.service');
const ApiError = require('../../utils/ApiError');
const { getIO } = require('../../sockets/state');
const {
  ensureActiveUser,
  ensureGroupInviteAllowed,
  ensureGroupInvitesAllowed,
} = require('../../utils/privacy');

async function ensureGroupMember(groupId, userId) {
  const group = await Group.findById(groupId);

  if (!group) {
    throw new ApiError(404, 'Group not found');
  }

  const membership = await GroupMember.findOne({ groupId, userId });
  if (!membership) {
    throw new ApiError(403, 'You are not a member of this group');
  }

  return { group, membership };
}

function canManageMembers(group, membership) {
  if (['owner', 'admin'].includes(membership.role)) {
    return true;
  }

  return !group.onlyAdminsCanAddMembers;
}

function canEditInfo(group, membership) {
  if (['owner', 'admin'].includes(membership.role)) {
    return true;
  }

  return !group.onlyAdminsCanEditInfo;
}

async function emitGroupEvent(group, eventName, payload) {
  const io = getIO();

  if (!io) {
    return;
  }

  io.to(`chat:${group.chatId}`).emit(eventName, payload);
}

async function createGroup(ownerId, payload) {
  await ensureActiveUser(ownerId, 'Owner not found');

  const uniqueMemberIds = [...new Set([String(ownerId), ...(payload.memberIds || []).map(String)])];
  await Promise.all(uniqueMemberIds.map((userId) => ensureActiveUser(userId, 'All group members must exist')));
  await ensureGroupInvitesAllowed(ownerId, uniqueMemberIds);

  const chat = await Chat.create({
    type: 'group',
    memberIds: uniqueMemberIds,
    createdBy: ownerId,
    participantSettings: uniqueMemberIds.map((userId) => ({ userId })),
  });

  const group = await Group.create({
    chatId: chat._id,
    name: payload.name,
    description: payload.description || '',
    image: payload.image || '',
    createdBy: ownerId,
    inviteCode: uuid().split('-')[0],
    onlyAdminsCanMessage: Boolean(payload.onlyAdminsCanMessage),
    onlyAdminsCanEditInfo: Boolean(payload.onlyAdminsCanEditInfo),
    onlyAdminsCanAddMembers: Boolean(payload.onlyAdminsCanAddMembers),
  });

  await GroupMember.create(
    uniqueMemberIds.map((userId) => ({
      groupId: group._id,
      userId,
      role: String(userId) === String(ownerId) ? 'owner' : 'member',
    })),
  );

  for (const userId of uniqueMemberIds) {
    if (String(userId) === String(ownerId)) {
      continue;
    }

    await notificationService.createNotification({
      userId,
      type: 'added_to_group',
      title: 'Added to group',
      body: `You were added to ${group.name}`,
      data: { groupId: group._id, chatId: chat._id },
    });
  }

  return group;
}

async function getGroupDetails(groupId, userId) {
  await ensureGroupMember(groupId, userId);
  const group = await Group.findById(groupId).populate('chatId');
  const members = await GroupMember.find({ groupId }).populate('userId', 'fullName username profileImage');

  return { group, members };
}

async function updateGroup(groupId, userId, payload) {
  const { group, membership } = await ensureGroupMember(groupId, userId);

  if (!canEditInfo(group, membership)) {
    throw new ApiError(403, 'You are not allowed to edit group info');
  }

  const allowedFields = [
    'name',
    'description',
    'image',
    'onlyAdminsCanMessage',
    'onlyAdminsCanEditInfo',
    'onlyAdminsCanAddMembers',
  ];

  for (const field of allowedFields) {
    if (payload[field] !== undefined) {
      group[field] = payload[field];
    }
  }

  await group.save();
  await emitGroupEvent(group, 'group:updated', group);

  return group;
}

async function addMembers(groupId, userId, userIds) {
  const { group, membership } = await ensureGroupMember(groupId, userId);

  if (!canManageMembers(group, membership)) {
    throw new ApiError(403, 'You are not allowed to add members');
  }

  const uniqueUserIds = [...new Set(userIds.map(String))];
  await Promise.all(uniqueUserIds.map((targetUserId) => ensureActiveUser(targetUserId, 'All users must exist')));

  const existingMembers = await GroupMember.find({ groupId, userId: { $in: uniqueUserIds } }).lean();
  const existingIds = new Set(existingMembers.map((member) => String(member.userId)));
  const toAdd = uniqueUserIds.filter((id) => !existingIds.has(id));

  if (!toAdd.length) {
    return group;
  }

  await ensureGroupInvitesAllowed(userId, toAdd);

  await GroupMember.create(
    toAdd.map((targetUserId) => ({
      groupId,
      userId: targetUserId,
      role: 'member',
    })),
  );

  await Chat.findByIdAndUpdate(group.chatId, {
    $addToSet: {
      memberIds: { $each: toAdd },
    },
    $push: {
      participantSettings: {
        $each: toAdd.map((targetUserId) => ({ userId: targetUserId })),
      },
    },
  });

  for (const targetUserId of toAdd) {
    await notificationService.createNotification({
      userId: targetUserId,
      type: 'added_to_group',
      title: 'Added to group',
      body: `You were added to ${group.name}`,
      data: { groupId, chatId: group.chatId },
    });
  }

  await emitGroupEvent(group, 'group:member-added', { groupId, userIds: toAdd });

  return Group.findById(groupId);
}

async function removeMember(groupId, actorId, targetUserId) {
  const { group, membership } = await ensureGroupMember(groupId, actorId);
  const targetMembership = await GroupMember.findOne({ groupId, userId: targetUserId });

  if (!targetMembership) {
    throw new ApiError(404, 'Target member not found');
  }

  const canRemove = membership.role === 'owner'
    || (membership.role === 'admin' && targetMembership.role === 'member')
    || String(actorId) === String(targetUserId);

  if (!canRemove) {
    throw new ApiError(403, 'You are not allowed to remove this member');
  }

  if (targetMembership.role === 'owner') {
    throw new ApiError(400, 'Owner cannot be removed');
  }

  await GroupMember.deleteOne({ _id: targetMembership._id });
  await Chat.findByIdAndUpdate(group.chatId, {
    $pull: {
      memberIds: targetUserId,
      participantSettings: { userId: targetUserId },
    },
  });

  await emitGroupEvent(group, 'group:member-removed', { groupId, userId: targetUserId });
}

async function promoteMember(groupId, actorId, targetUserId) {
  const { group, membership } = await ensureGroupMember(groupId, actorId);

  if (!['owner', 'admin'].includes(membership.role)) {
    throw new ApiError(403, 'You are not allowed to promote members');
  }

  const targetMembership = await GroupMember.findOne({ groupId, userId: targetUserId });
  if (!targetMembership) {
    throw new ApiError(404, 'Target member not found');
  }

  if (membership.role !== 'owner' && targetMembership.role !== 'member') {
    throw new ApiError(403, 'Only the owner can promote admins');
  }

  targetMembership.role = 'admin';
  await targetMembership.save();

  await notificationService.createNotification({
    userId: targetUserId,
    type: 'promoted_to_admin',
    title: 'Promoted to admin',
    body: `You were promoted to admin in ${group.name}`,
    data: { groupId, chatId: group.chatId },
  });

  return targetMembership;
}

async function demoteMember(groupId, actorId, targetUserId) {
  const { membership } = await ensureGroupMember(groupId, actorId);

  if (membership.role !== 'owner') {
    throw new ApiError(403, 'Only the owner can demote admins');
  }

  const targetMembership = await GroupMember.findOne({ groupId, userId: targetUserId });
  if (!targetMembership) {
    throw new ApiError(404, 'Target member not found');
  }

  if (targetMembership.role === 'owner') {
    throw new ApiError(400, 'Owner cannot be demoted');
  }

  targetMembership.role = 'member';
  await targetMembership.save();

  return targetMembership;
}

async function transferOwnership(groupId, actorId, targetUserId) {
  const { group, membership } = await ensureGroupMember(groupId, actorId);

  if (membership.role !== 'owner') {
    throw new ApiError(403, 'Only the owner can transfer ownership');
  }

  const targetMembership = await GroupMember.findOne({ groupId, userId: targetUserId });
  if (!targetMembership) {
    throw new ApiError(404, 'Target member not found');
  }

  if (String(actorId) === String(targetUserId)) {
    throw new ApiError(400, 'You already own this group');
  }

  membership.role = 'admin';
  targetMembership.role = 'owner';
  group.createdBy = targetUserId;

  await Promise.all([
    membership.save(),
    targetMembership.save(),
    group.save(),
  ]);

  await notificationService.createNotification({
    userId: targetUserId,
    type: 'group_ownership_transferred',
    title: 'Group ownership transferred',
    body: `You are now the owner of ${group.name}`,
    data: { groupId, chatId: group.chatId },
  });

  await emitGroupEvent(group, 'group:ownership-transferred', {
    groupId,
    fromUserId: actorId,
    toUserId: targetUserId,
  });

  return group;
}

async function leaveGroup(groupId, userId) {
  const { membership } = await ensureGroupMember(groupId, userId);

  if (membership.role === 'owner') {
    throw new ApiError(400, 'Owner cannot leave the group without transferring ownership');
  }

  await removeMember(groupId, userId, userId);
}

async function regenerateInviteCode(groupId, userId) {
  const { group, membership } = await ensureGroupMember(groupId, userId);

  if (!['owner', 'admin'].includes(membership.role)) {
    throw new ApiError(403, 'You are not allowed to generate invite codes');
  }

  group.inviteCode = uuid().split('-')[0];
  await group.save();

  return group;
}

async function joinByInviteCode(inviteCode, userId) {
  const group = await Group.findOne({ inviteCode });

  if (!group) {
    throw new ApiError(404, 'Invite code not found');
  }

  await ensureActiveUser(userId, 'User not found');
  await ensureGroupInviteAllowed(group.createdBy, userId);

  const existing = await GroupMember.findOne({ groupId: group._id, userId });
  if (existing) {
    return group;
  }

  await GroupMember.create({
    groupId: group._id,
    userId,
    role: 'member',
  });

  await Chat.findByIdAndUpdate(group.chatId, {
    $addToSet: {
      memberIds: userId,
    },
    $push: {
      participantSettings: { userId },
    },
  });

  await notificationService.createNotification({
    userId: group.createdBy,
    type: 'group_joined_via_invite',
    title: 'Member joined via invite',
    body: 'A member joined your group using the invite code',
    data: { groupId: group._id, chatId: group.chatId, userId },
  });

  await emitGroupEvent(group, 'group:member-added', { groupId: group._id, userIds: [userId] });

  return group;
}

async function deleteGroup(groupId, userId) {
  const { group, membership } = await ensureGroupMember(groupId, userId);

  if (membership.role !== 'owner') {
    throw new ApiError(403, 'Only the owner can delete the group');
  }

  await Promise.all([
    GroupMember.deleteMany({ groupId }),
    Message.deleteMany({ chatId: group.chatId }),
    Chat.findByIdAndDelete(group.chatId),
    Group.findByIdAndDelete(groupId),
  ]);
}

module.exports = {
  createGroup,
  getGroupDetails,
  updateGroup,
  addMembers,
  removeMember,
  promoteMember,
  demoteMember,
  transferOwnership,
  leaveGroup,
  regenerateInviteCode,
  joinByInviteCode,
  deleteGroup,
};
