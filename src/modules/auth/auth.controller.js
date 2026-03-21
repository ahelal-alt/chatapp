const ApiResponse = require('../../utils/ApiResponse');
const asyncHandler = require('../../utils/asyncHandler');
const authService = require('./auth.service');

function getRequestMeta(req) {
  return {
    ipAddress: req.ip,
    userAgent: req.get('user-agent') || '',
    userId: req.user?._id ? String(req.user._id) : '',
  };
}

function setNoStore(res) {
  res.set('Cache-Control', 'no-store');
}

const register = asyncHandler(async (req, res) => {
  setNoStore(res);
  const data = await authService.register(req.body, getRequestMeta(req));
  res.status(201).json(new ApiResponse('User registered successfully', data));
});

const login = asyncHandler(async (req, res) => {
  setNoStore(res);
  const data = await authService.login(req.body, getRequestMeta(req));
  res.json(new ApiResponse('Login successful', data));
});

const logout = asyncHandler(async (req, res) => {
  setNoStore(res);
  const data = await authService.logout(req.body || {}, getRequestMeta(req));
  res.json(new ApiResponse(data.message));
});

const refreshToken = asyncHandler(async (req, res) => {
  setNoStore(res);
  const data = await authService.refreshToken(req.body, getRequestMeta(req));
  res.json(new ApiResponse('Token refreshed successfully', data));
});

const me = asyncHandler(async (req, res) => {
  setNoStore(res);
  const user = await authService.getCurrentUser(req.user._id);
  res.json(new ApiResponse('Current user fetched successfully', user));
});

const changePassword = asyncHandler(async (req, res) => {
  setNoStore(res);
  await authService.changePassword(req.user._id, req.body, getRequestMeta(req));
  res.json(new ApiResponse('Password changed successfully'));
});

const forgotPassword = asyncHandler(async (req, res) => {
  setNoStore(res);
  const data = await authService.forgotPassword(req.body, getRequestMeta(req));
  res.json(new ApiResponse(data.message, data.devOnly || null));
});

const resetPassword = asyncHandler(async (req, res) => {
  setNoStore(res);
  const data = await authService.resetPassword(req.body, getRequestMeta(req));
  res.json(new ApiResponse(data.message));
});

const verifyEmail = asyncHandler(async (req, res) => {
  setNoStore(res);
  const data = await authService.verifyEmail(req.body, getRequestMeta(req));
  res.json(new ApiResponse(data.message || 'Email verified successfully', data));
});

const resendVerification = asyncHandler(async (req, res) => {
  setNoStore(res);
  const data = await authService.resendVerification(req.user?._id, req.body, getRequestMeta(req));
  res.json(new ApiResponse(data.message, data.devOnly || null));
});

const logoutAll = asyncHandler(async (req, res) => {
  setNoStore(res);
  const data = await authService.logoutAll(req.user._id, getRequestMeta(req));
  res.json(new ApiResponse(data.message));
});

const listSessions = asyncHandler(async (req, res) => {
  setNoStore(res);
  const sessions = await authService.listSessions(req.user._id);
  res.json(new ApiResponse('Sessions fetched successfully', sessions));
});

const revokeSession = asyncHandler(async (req, res) => {
  setNoStore(res);
  const data = await authService.revokeSession(req.user._id, req.params.sessionId, getRequestMeta(req));
  res.json(new ApiResponse(data.message));
});

const deactivateAccount = asyncHandler(async (req, res) => {
  setNoStore(res);
  const data = await authService.deactivateAccount(req.user._id, req.body, getRequestMeta(req));
  res.json(new ApiResponse(data.message));
});

const deleteAccount = asyncHandler(async (req, res) => {
  setNoStore(res);
  const data = await authService.deleteAccount(req.user._id, req.body, getRequestMeta(req));
  res.json(new ApiResponse(data.message));
});

module.exports = {
  register,
  login,
  logout,
  logoutAll,
  listSessions,
  revokeSession,
  deactivateAccount,
  deleteAccount,
  refreshToken,
  me,
  changePassword,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
};
