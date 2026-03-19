const mongoose = require('mongoose');

const contactRequestSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'cancelled'],
      default: 'pending',
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

contactRequestSchema.index({ senderId: 1, receiverId: 1 }, { unique: true });
contactRequestSchema.index({ receiverId: 1, status: 1 });

module.exports = mongoose.model('ContactRequest', contactRequestSchema);

