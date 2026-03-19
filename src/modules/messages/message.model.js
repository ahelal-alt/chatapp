const mongoose = require('mongoose');

const seenBySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    seenAt: {
      type: Date,
      required: true,
    },
  },
  { _id: false },
);

const messageSchema = new mongoose.Schema(
  {
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Chat',
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['text', 'image', 'video', 'audio', 'file', 'voice', 'location', 'system'],
      default: 'text',
    },
    text: {
      type: String,
      default: '',
    },
    mediaUrl: {
      type: String,
      default: '',
    },
    thumbnailUrl: {
      type: String,
      default: '',
    },
    mimeType: {
      type: String,
      default: '',
    },
    fileName: {
      type: String,
      default: '',
    },
    fileSize: {
      type: Number,
      default: 0,
    },
    duration: {
      type: Number,
      default: 0,
    },
    latitude: {
      type: Number,
      default: null,
    },
    longitude: {
      type: Number,
      default: null,
    },
    replyToMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    forwardedFromMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    deliveredTo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    seenBy: {
      type: [seenBySchema],
      default: [],
    },
    editedAt: {
      type: Date,
      default: null,
    },
    deletedForEveryone: {
      type: Boolean,
      default: false,
    },
    deletedForUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  {
    timestamps: true,
  },
);

messageSchema.index({ chatId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);

