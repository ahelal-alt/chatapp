const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const env = require('../config/env');

function buildJwtOptions(expiresIn) {
  return {
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
    expiresIn,
  };
}

function signAccessToken(payload) {
  return jwt.sign(payload, env.jwt.accessSecret, buildJwtOptions(env.jwt.accessExpiresIn));
}

function signRefreshToken(payload, options = {}) {
  return jwt.sign(payload, env.jwt.refreshSecret, buildJwtOptions(
    options.rememberMe ? env.jwt.rememberMeRefreshExpiresIn : env.jwt.refreshExpiresIn,
  ));
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret, {
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
  });
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwt.refreshSecret, {
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
  });
}

function generateOpaqueToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashOpaqueToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateTokenId() {
  return uuidv4();
}

function getRefreshTokenExpiryDate(rememberMe = false) {
  const days = rememberMe ? env.auth.loginRememberMeDays : 30;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateOpaqueToken,
  hashOpaqueToken,
  generateTokenId,
  getRefreshTokenExpiryDate,
};
