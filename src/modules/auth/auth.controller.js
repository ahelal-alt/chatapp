const ApiResponse = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const authService = require('./auth.service');

const register = asyncHandler(async (req, res) => {
  const data = await authService.register(req.body);
  res.status(201).json(new ApiResponse('User registered successfully', data));
});

const login = asyncHandler(async (req, res) => {
  const data = await authService.login(req.body);
  res.json(new ApiResponse('Login successful', data));
});

const logout = asyncHandler(async (req, res) => {
  const data = await authService.logout();
  res.json(new ApiResponse(data.message));
});

const refreshToken = asyncHandler(async (req, res) => {
  const data = await authService.refreshToken(req.body);
  res.json(new ApiResponse('Token refreshed successfully', data));
});

const me = asyncHandler(async (req, res) => {
  const user = await authService.getCurrentUser(req.user._id);
  res.json(new ApiResponse('Current user fetched successfully', user));
});

const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword(req.user._id, req.body);
  res.json(new ApiResponse('Password changed successfully'));
});

const forgotPassword = asyncHandler(async (req, res) => {
  const data = await authService.forgotPassword(req.body);
  res.json(new ApiResponse(data.message, data.devOnly || null));
});

const resetPassword = asyncHandler(async (req, res) => {
  const data = await authService.resetPassword(req.body);
  res.json(new ApiResponse(data.message));
});

const verifyEmail = asyncHandler(async (req, res) => {
  const data = await authService.verifyEmail(req.body);
  res.json(new ApiResponse(data.message));
});

const resendVerification = asyncHandler(async (req, res) => {
  const data = await authService.resendVerification(req.user?._id, req.body);
  res.json(new ApiResponse(data.message, data.devOnly || null));
});

module.exports = {
  register,
  login,
  logout,
  refreshToken,
  me,
  changePassword,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
};

