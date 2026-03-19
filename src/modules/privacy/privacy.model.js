const mongoose = require('mongoose');

const privacySettingsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    messagePermission: {
      type: String,
      enum: ['everyone', 'contacts'],
      default: 'contacts',
    },
    profilePhotoVisibility: {
      type: String,
      enum: ['everyone', 'contacts', 'nobody'],
      default: 'everyone',
    },
    lastSeenVisibility: {
      type: String,
      enum: ['everyone', 'contacts', 'nobody'],
      default: 'contacts',
    },
    onlineStatusVisibility: {
      type: String,
      enum: ['everyone', 'contacts', 'nobody'],
      default: 'contacts',
    },
    groupInvitePermission: {
      type: String,
      enum: ['everyone', 'contacts'],
      default: 'contacts',
    },
    readReceiptsEnabled: {
      type: Boolean,
      default: true,
    },
    typingIndicatorEnabled: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('PrivacySettings', privacySettingsSchema);

