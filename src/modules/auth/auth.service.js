const User = require('../users/user.model');
const PrivacySettings = require('../privacy/privacy.model');
const ApiError = require('../../utils/ApiError');
const ApiResponse = require('../../utils/ApiResponse');
const auditLog = require('../../utils/audit');
const { hashPassword, comparePassword } = require('../../utils/password');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  generateOpaqueToken,
  hashOpaqueToken,
} = require('../../utils/token');

function buildAuthPayload(user) {
  return {
    user,
    tokens: {
      accessToken: signAccessToken({ sub: String(user._id), role: user.role }),
      refreshToken: signRefreshToken({ sub: String(user._id), role: user.role }),
    },
  };
}

async function register(payload) {
  const email = payload.email.toLowerCase();
  const username = payload.username.toLowerCase();

  const existingUser = await User.findOne({
    $or: [{ email }, { username }],
  }).lean();

  if (existingUser) {
    throw new ApiError(409, 'User with this email or username already exists');
  }

  const verificationToken = generateOpaqueToken();
  const user = await User.create({
    fullName: payload.fullName,
    username,
    email,
    passwordHash: await hashPassword(payload.password),
    verificationToken: hashOpaqueToken(verificationToken),
  });

  await PrivacySettings.create({ userId: user._id });

  const response = buildAuthPayload(user);
  if (process.env.NODE_ENV !== 'production') {
    response.devOnly = {
      verificationToken,
    };
  }

  return response;
}

async function login(payload) {
  const user = await User.findOne({ email: payload.email.toLowerCase() }).select('+passwordHash');

  if (!user || !(await comparePassword(payload.password, user.passwordHash))) {
    throw new ApiError(401, 'Invalid email or password');
  }

  if (!user.isActive) {
    throw new ApiError(403, 'This account is suspended');
  }

  return buildAuthPayload(user.toJSON ? user.toJSON() : user);
}

async function getCurrentUser(userId) {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  return user;
}

async function changePassword(userId, payload) {
  const user = await User.findById(userId).select('+passwordHash');

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const matches = await comparePassword(payload.currentPassword, user.passwordHash);
  if (!matches) {
    throw new ApiError(400, 'Current password is incorrect');
  }

  user.passwordHash = await hashPassword(payload.newPassword);
  await user.save();

  auditLog('auth.change_password', userId, {});

  return new ApiResponse('Password changed successfully');
}

async function forgotPassword(payload) {
  const user = await User.findOne({ email: payload.email.toLowerCase() }).select('+resetPasswordToken +resetPasswordExpiresAt');

  if (!user) {
    return {
      message: 'If the email exists, a reset link has been prepared',
    };
  }

  const token = generateOpaqueToken();
  user.resetPasswordToken = hashOpaqueToken(token);
  user.resetPasswordExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await user.save();

  return {
    message: 'If the email exists, a reset link has been prepared',
    ...(process.env.NODE_ENV !== 'production' ? { devOnly: { resetToken: token } } : {}),
  };
}

async function resetPassword(payload) {
  const user = await User.findOne({
    resetPasswordToken: hashOpaqueToken(payload.token),
    resetPasswordExpiresAt: { $gt: new Date() },
  }).select('+passwordHash +resetPasswordToken +resetPasswordExpiresAt');

  if (!user) {
    throw new ApiError(400, 'Invalid or expired reset token');
  }

  user.passwordHash = await hashPassword(payload.password);
  user.resetPasswordToken = null;
  user.resetPasswordExpiresAt = null;
  await user.save();

  auditLog('auth.reset_password', user._id, {});

  return {
    message: 'Password reset successfully',
  };
}

async function verifyEmail(payload) {
  const user = await User.findOne({
    verificationToken: hashOpaqueToken(payload.token),
  }).select('+verificationToken');

  if (!user) {
    throw new ApiError(400, 'Invalid verification token');
  }

  user.isVerified = true;
  user.verificationToken = null;
  await user.save();

  return {
    message: 'Email verified successfully',
  };
}

async function resendVerification(userId, payload = {}) {
  const query = userId ? { _id: userId } : { email: payload.email?.toLowerCase() };
  const user = await User.findOne(query).select('+verificationToken');

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  if (user.isVerified) {
    throw new ApiError(400, 'Email is already verified');
  }

  const token = generateOpaqueToken();
  user.verificationToken = hashOpaqueToken(token);
  await user.save();

  return {
    message: 'Verification email prepared',
    ...(process.env.NODE_ENV !== 'production' ? { devOnly: { verificationToken: token } } : {}),
  };
}

async function refreshToken(payload) {
  const decoded = verifyRefreshToken(payload.refreshToken);
  const user = await User.findById(decoded.sub);

  if (!user || !user.isActive) {
    throw new ApiError(401, 'Invalid refresh token');
  }

  return {
    tokens: {
      accessToken: signAccessToken({ sub: String(user._id), role: user.role }),
      refreshToken: signRefreshToken({ sub: String(user._id), role: user.role }),
    },
  };
}

async function logout() {
  return {
    message: 'Logged out successfully',
  };
}

module.exports = {
  register,
  login,
  getCurrentUser,
  changePassword,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  refreshToken,
  logout,
};

