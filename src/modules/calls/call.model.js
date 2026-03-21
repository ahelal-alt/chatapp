const mongoose = require('mongoose');

const callParticipantSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    state: {
      type: String,
      enum: ['ringing', 'connecting', 'connected', 'declined', 'left', 'ended', 'missed'],
      default: 'ringing',
    },
    invitedAt: {
      type: Date,
      default: null,
    },
    answeredAt: {
      type: Date,
      default: null,
    },
    joinedAt: {
      type: Date,
      default: null,
    },
    leftAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
);

const callSchema = new mongoose.Schema(
  {
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Chat',
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['voice', 'video'],
      default: 'voice',
    },
    status: {
      type: String,
      enum: ['ringing', 'connecting', 'connected', 'declined', 'ended', 'missed'],
      default: 'ringing',
      index: true,
    },
    participants: {
      type: [callParticipantSchema],
      default: [],
    },
    startedAt: {
      type: Date,
      default: null,
    },
    signalingVersion: {
      type: Number,
      default: 0,
    },
    endedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('Call', callSchema);
