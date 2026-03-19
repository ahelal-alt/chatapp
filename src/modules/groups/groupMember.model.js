const mongoose = require('mongoose');

const groupMemberSchema = new mongoose.Schema(
  {
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['owner', 'admin', 'member'],
      default: 'member',
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    mutedUntil: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: false,
  },
);

groupMemberSchema.index({ groupId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('GroupMember', groupMemberSchema);

