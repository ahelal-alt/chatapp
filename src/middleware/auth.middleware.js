const User = require('../modules/users/user.model');
const ApiError = require('../utils/ApiError');
const { verifyAccessToken } = require('../utils/token');

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return next(new ApiError(401, 'Authentication required'));
    }

    const payload = verifyAccessToken(token);
    if (payload.type && payload.type !== 'access') {
      return next(new ApiError(401, 'Invalid authentication token'));
    }

    const user = await User.findById(payload.sub).select('+sessionVersion +lockUntil');

    const sessionVersion = user?.sessionVersion || 0;
    const tokenSessionVersion = payload.sv ?? 0;
    const accountLocked = Boolean(user?.lockUntil && user.lockUntil > new Date());
    const accountAvailable = user
      && user.accountStatus !== 'disabled'
      && user.accountStatus !== 'deleted'
      && user.accountStatus !== 'suspended'
      && user.accountStatus !== 'pending_verification'
      && !accountLocked
      && user.isActive;

    if (!user || !accountAvailable || String(sessionVersion) !== String(tokenSessionVersion)) {
      return next(new ApiError(401, 'Invalid authentication token'));
    }

    req.user = user;
    return next();
  } catch (error) {
    return next(new ApiError(401, 'Invalid authentication token'));
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(401, 'Authentication required'));
    }

    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, 'You are not allowed to perform this action'));
    }

    return next();
  };
}

module.exports = {
  authenticate,
  authorize,
};
