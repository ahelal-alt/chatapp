const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema(
  {
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Chat',
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    image: {
      type: String,
      default: '',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    inviteCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    onlyAdminsCanMessage: {
      type: Boolean,
      default: false,
    },
    onlyAdminsCanEditInfo: {
      type: Boolean,
      default: false,
    },
    onlyAdminsCanAddMembers: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('Group', groupSchema);

