const mongoose = require('mongoose');

const participantSettingsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    archivedAt: {
      type: Date,
      default: null,
    },
    mutedUntil: {
      type: Date,
      default: null,
    },
    pinnedAt: {
      type: Date,
      default: null,
    },
    clearedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
);

const chatSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['private', 'group'],
      required: true,
      index: true,
    },
    memberIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true,
      },
    ],
    memberHash: {
      type: String,
      default: null,
    },
    lastMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    lastMessagePreview: {
      type: String,
      default: '',
    },
    lastMessageAt: {
      type: Date,
      default: null,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
    participantSettings: {
      type: [participantSettingsSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

chatSchema.index({ memberIds: 1 });
chatSchema.index(
  { memberHash: 1 },
  {
    unique: true,
    partialFilterExpression: { type: 'private' },
  },
);

module.exports = mongoose.model('Chat', chatSchema);

