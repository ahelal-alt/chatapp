const mongoose = require('mongoose');

const inviteSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
    },
    emailNormalized: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    invitedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'revoked', 'expired'],
      default: 'pending',
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    lastSentAt: {
      type: Date,
      default: null,
    },
    acceptedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

inviteSchema.index(
  { invitedByUserId: 1, emailNormalized: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
);

module.exports = mongoose.model('Invite', inviteSchema);
