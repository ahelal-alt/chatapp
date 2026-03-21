const rateLimit = require('express-rate-limit');
const env = require('../config/env');

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function buildLimiter({ windowMs, max, message, keyGenerator, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    keyGenerator,
    message: {
      success: false,
      message,
    },
  });
}

const authRateLimit = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many authentication requests. Please try again later.',
});

const loginRateLimit = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: 'Too many login attempts. Please try again later.',
  keyGenerator: (req) => `${req.ip}:${normalizeKey(req.body?.email) || 'unknown'}`,
});

const registrationRateLimit = buildLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many registration attempts. Please try again later.',
  keyGenerator: (req) => `${req.ip}:${normalizeKey(req.body?.email) || 'unknown'}`,
});

const passwordResetRateLimit = buildLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many reset requests. Please try again later.',
  keyGenerator: (req) => `${req.ip}:${normalizeKey(req.body?.email) || normalizeKey(req.body?.token) || 'unknown'}`,
});

const verificationRateLimit = buildLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many verification requests. Please try again later.',
  keyGenerator: (req) => `${req.ip}:${normalizeKey(req.body?.email) || normalizeKey(req.body?.token) || String(req.user?._id || '') || 'unknown'}`,
});

const apiRateLimit = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: env.nodeEnv === 'production' ? 1500 : 5000,
  message: 'Too many API requests. Please try again later.',
  keyGenerator: (req) => {
    const authKey = String(req.get('authorization') || '').slice(-32);
    return `${req.ip}:${authKey || 'anonymous'}`;
  },
});

module.exports = {
  authRateLimit,
  loginRateLimit,
  registrationRateLimit,
  passwordResetRateLimit,
  verificationRateLimit,
  apiRateLimit,
};
