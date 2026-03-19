const ApiResponse = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const userService = require('./user.service');

const getMe = asyncHandler(async (req, res) => {
  const result = await userService.getMyProfile(req.user._id);
  res.json(new ApiResponse('Profile fetched successfully', result));
});

const updateMe = asyncHandler(async (req, res) => {
  const user = await userService.updateMyProfile(req.user._id, req.body);
  res.json(new ApiResponse('Profile updated successfully', user));
});

const updateMyProfileImage = asyncHandler(async (req, res) => {
  const user = await userService.updateProfileImage(req.user._id, req.body.profileImage);
  res.json(new ApiResponse('Profile image updated successfully', user));
});

const getProfileById = asyncHandler(async (req, res) => {
  const user = await userService.getPublicProfile(req.user?._id, req.params.userId);
  res.json(new ApiResponse('Profile fetched successfully', user));
});

const searchUsers = asyncHandler(async (req, res) => {
  const result = await userService.searchUsers(req.user._id, req.query);
  res.json(new ApiResponse('Users fetched successfully', result.items, result.meta));
});

const getMutualContacts = asyncHandler(async (req, res) => {
  const users = await userService.getMutualContacts(req.user._id, req.params.userId);
  res.json(new ApiResponse('Mutual contacts fetched successfully', users));
});

module.exports = {
  getMe,
  updateMe,
  updateMyProfileImage,
  getProfileById,
  searchUsers,
  getMutualContacts,
};

