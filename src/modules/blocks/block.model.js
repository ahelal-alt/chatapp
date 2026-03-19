const mongoose = require('mongoose');

const blockSchema = new mongoose.Schema(
  {
    blockerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    blockedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
  },
  {
    timestamps: {
      createdAt: true,
      updatedAt: false,
    },
  },
);

blockSchema.index({ blockerUserId: 1, blockedUserId: 1 }, { unique: true });

module.exports = mongoose.model('Block', blockSchema);

