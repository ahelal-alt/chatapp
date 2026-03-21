const bcrypt = require('bcryptjs');
const env = require('../config/env');

function hashPassword(password) {
  return bcrypt.hash(password, env.bcryptSaltRounds);
}

function comparePassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

const COMMON_PASSWORDS = new Set([
  '12345678',
  '123456789',
  '1234567890',
  'password',
  'password1',
  'qwerty123',
  'letmein',
  'welcome123',
  'iloveyou',
  'admin123',
  'abc123456',
  '123123123',
]);

function normalizePasswordValue(value) {
  return String(value || '');
}

function buildUserAttributeTokens(context = {}) {
  return [
    context.email,
    context.username,
    context.fullName,
    ...(String(context.email || '').split('@')[0] ? [String(context.email || '').split('@')[0]] : []),
  ]
    .flatMap((value) => String(value || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/i))
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function evaluatePassword(password, context = {}) {
  const candidate = normalizePasswordValue(password);
  const normalized = candidate.toLowerCase();
  const reasons = [];

  if (candidate.length < env.auth.passwordMinLength) {
    reasons.push(`Password must be at least ${env.auth.passwordMinLength} characters long.`);
  }

  if (candidate.length > env.auth.passwordMaxLength) {
    reasons.push(`Password must be no more than ${env.auth.passwordMaxLength} characters long.`);
  }

  if (COMMON_PASSWORDS.has(normalized)) {
    reasons.push('Password is too common. Please choose a less predictable passphrase.');
  }

  const attributeTokens = buildUserAttributeTokens(context);
  if (attributeTokens.some((token) => normalized.includes(token))) {
    reasons.push('Password must not contain your name, username, or email.');
  }

  let score = 0;
  if (candidate.length >= env.auth.passwordMinLength) score += 1;
  if (candidate.length >= 16) score += 1;
  if (/[A-Z]/.test(candidate) && /[a-z]/.test(candidate)) score += 1;
  if (/\d/.test(candidate)) score += 1;
  if (/[^A-Za-z0-9]/.test(candidate)) score += 1;

  return {
    isValid: reasons.length === 0,
    reasons,
    score,
  };
}

module.exports = {
  hashPassword,
  comparePassword,
  evaluatePassword,
};
