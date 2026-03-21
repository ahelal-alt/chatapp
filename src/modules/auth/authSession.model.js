const mongoose = require('mongoose');

const authSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
      select: false,
    },
    tokenId: {
      type: String,
      required: true,
      index: true,
    },
    sessionVersion: {
      type: Number,
      required: true,
      default: 0,
    },
    rememberMe: {
      type: Boolean,
      default: false,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    replacedByTokenHash: {
      type: String,
      default: null,
      select: false,
    },
    revokeReason: {
      type: String,
      default: '',
    },
    createdIp: {
      type: String,
      default: '',
    },
    lastUsedIp: {
      type: String,
      default: '',
    },
    userAgent: {
      type: String,
      default: '',
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

authSessionSchema.index({ userId: 1, revokedAt: 1, expiresAt: 1 });

module.exports = mongoose.model('AuthSession', authSessionSchema);
