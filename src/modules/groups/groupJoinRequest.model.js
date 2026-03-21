const mongoose = require('mongoose');

const groupJoinRequestSchema = new mongoose.Schema(
  {
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group',
      required: true,
      index: true,
    },
    requesterUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    message: {
      type: String,
      default: '',
      trim: true,
      maxlength: 300,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
      index: true,
    },
    reviewedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

groupJoinRequestSchema.index(
  { groupId: 1, requesterUserId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
  },
);

module.exports = mongoose.model('GroupJoinRequest', groupJoinRequestSchema);
