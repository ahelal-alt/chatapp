const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
      lowercase: true,
    },
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
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    profileImage: {
      type: String,
      default: '',
    },
    bio: {
      type: String,
      default: '',
      maxlength: 250,
    },
    location: {
      type: String,
      default: '',
      maxlength: 100,
    },
    statusMessage: {
      type: String,
      default: '',
      maxlength: 120,
    },
    isOnline: {
      type: Boolean,
      default: false,
    },
    lastSeen: {
      type: Date,
      default: null,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    verificationTokenHash: {
      type: String,
      select: false,
      default: null,
    },
    verificationTokenExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
    verificationEmailSentAt: {
      type: Date,
      default: null,
      select: false,
    },
    passwordResetTokenHash: {
      type: String,
      select: false,
      default: null,
    },
    passwordResetTokenExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
    passwordResetRequestedAt: {
      type: Date,
      default: null,
      select: false,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    encryptionPublicKey: {
      type: String,
      default: '',
    },
    encryptionKeyVersion: {
      type: Number,
      default: 0,
    },
    encryptionEnabled: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    accountStatus: {
      type: String,
      enum: ['active', 'pending_verification', 'disabled', 'locked', 'suspended', 'deleted'],
      default: 'active',
      index: true,
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
      select: false,
    },
    lockUntil: {
      type: Date,
      default: null,
      select: false,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    lastPasswordChangedAt: {
      type: Date,
      default: null,
      select: false,
    },
    sessionVersion: {
      type: Number,
      default: 0,
      select: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      select: false,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      select: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.passwordHash;
        delete ret.emailNormalized;
        delete ret.verificationToken;
        delete ret.verificationTokenHash;
        delete ret.verificationTokenExpiresAt;
        delete ret.verificationEmailSentAt;
        delete ret.resetPasswordToken;
        delete ret.resetPasswordExpiresAt;
        delete ret.passwordResetTokenHash;
        delete ret.passwordResetTokenExpiresAt;
        delete ret.passwordResetRequestedAt;
        delete ret.failedLoginAttempts;
        delete ret.lockUntil;
        delete ret.lastPasswordChangedAt;
        delete ret.sessionVersion;
        delete ret.createdBy;
        delete ret.approvedBy;
        return ret;
      },
    },
  },
);

userSchema.pre('validate', function syncNormalizedFields(next) {
  if (this.email) {
    const normalizedEmail = String(this.email).trim().toLowerCase();
    this.email = normalizedEmail;
    this.emailNormalized = normalizedEmail;
  }

  if (this.username) {
    this.username = String(this.username).trim().toLowerCase();
  }

  if (this.isEmailVerified || this.isVerified) {
    this.isEmailVerified = true;
    this.isVerified = true;
  }

  if (this.accountStatus === 'active' && this.isActive === false) {
    this.isActive = true;
  }

  if (['disabled', 'locked', 'suspended', 'deleted', 'pending_verification'].includes(this.accountStatus)) {
    this.isActive = this.accountStatus === 'active';
  }

  next();
});

userSchema.index({ username: 1 }, { unique: true });
userSchema.index({ emailNormalized: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);
