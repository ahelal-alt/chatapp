const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const env = require('./config/env');
const { setupSwagger } = require('./docs/swagger');
const { apiRateLimit, authRateLimit } = require('./middleware/rateLimit.middleware');
const { notFoundHandler, errorHandler } = require('./middleware/error.middleware');

const authRoutes = require('./modules/auth/auth.routes');
const userRoutes = require('./modules/users/user.routes');
const privacyRoutes = require('./modules/privacy/privacy.routes');
const contactRequestRoutes = require('./modules/contacts/contactRequest.routes');
const contactRoutes = require('./modules/contacts/contact.routes');
const blockRoutes = require('./modules/blocks/block.routes');
const chatRoutes = require('./modules/chats/chat.routes');
const messageRoutes = require('./modules/messages/message.routes');
const groupRoutes = require('./modules/groups/group.routes');
const notificationRoutes = require('./modules/notifications/notification.routes');
const uploadRoutes = require('./modules/uploads/upload.routes');
const reportRoutes = require('./modules/reports/report.routes');
const adminRoutes = require('./modules/admin/admin.routes');
const searchRoutes = require('./modules/search/search.routes');
const inviteRoutes = require('./modules/invites/invite.routes');
const callRoutes = require('./modules/calls/call.routes');

const app = express();
const publicDir = path.resolve(process.cwd(), 'public');

app.use(helmet());
app.use(cors({ origin: env.clientUrl, credentials: true }));
app.use(compression());
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(mongoSanitize());
app.use(apiRateLimit);
app.use(`/${env.uploadDir}`, express.static(path.resolve(process.cwd(), env.uploadDir)));
app.use(express.static(publicDir));

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Service is healthy',
    data: {
      appName: env.appName,
      environment: env.nodeEnv,
    },
  });
});

app.use('/api/v1/auth', authRateLimit, authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/privacy', privacyRoutes);
app.use('/api/v1/contact-requests', contactRequestRoutes);
app.use('/api/v1/contacts', contactRoutes);
app.use('/api/v1/blocks', blockRoutes);
app.use('/api/v1/chats', chatRoutes);
app.use('/api/v1/messages', messageRoutes);
app.use('/api/v1/groups', groupRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/uploads', uploadRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/search', searchRoutes);
app.use('/api/v1/invites', inviteRoutes);
app.use('/api/v1/calls', callRoutes);

setupSwagger(app);

app.get('*', (req, res, next) => {
  if (req.method !== 'GET') {
    next();
    return;
  }

  if (req.path === '/health'
    || req.path.startsWith('/api/')
    || req.path.startsWith('/docs')
    || req.path.startsWith(`/${env.uploadDir}`)) {
    next();
    return;
  }

  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
