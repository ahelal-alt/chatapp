const dotenv = require('dotenv');

dotenv.config();

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  appName: process.env.APP_NAME || 'chat-app',
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/chat_app',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'change-me-access',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'change-me-refresh',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    rememberMeRefreshExpiresIn: process.env.JWT_REMEMBER_ME_REFRESH_EXPIRES_IN || '45d',
    issuer: process.env.JWT_ISSUER || 'pulsechat',
    audience: process.env.JWT_AUDIENCE || 'pulsechat-web',
  },
  bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS) || 10,
  auth: {
    requireEmailVerification: process.env.AUTH_REQUIRE_EMAIL_VERIFICATION !== 'false',
    passwordMinLength: Number(process.env.AUTH_PASSWORD_MIN_LENGTH) || 12,
    passwordMaxLength: Number(process.env.AUTH_PASSWORD_MAX_LENGTH) || 1024,
    maxFailedLoginAttempts: Number(process.env.AUTH_MAX_FAILED_LOGIN_ATTEMPTS) || 5,
    accountLockMinutes: Number(process.env.AUTH_ACCOUNT_LOCK_MINUTES) || 15,
    verificationTokenTtlMinutes: Number(process.env.AUTH_VERIFICATION_TOKEN_TTL_MINUTES) || 1440,
    resetTokenTtlMinutes: Number(process.env.AUTH_RESET_TOKEN_TTL_MINUTES) || 60,
    resendVerificationCooldownSeconds: Number(process.env.AUTH_RESEND_VERIFICATION_COOLDOWN_SECONDS) || 60,
    loginRememberMeDays: Number(process.env.AUTH_LOGIN_REMEMBER_ME_DAYS) || 45,
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
  },
  storageDriver: process.env.STORAGE_DRIVER || 'local',
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB) || 20,
};
