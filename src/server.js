const http = require('http');
const app = require('./app');
const env = require('./config/env');
const connectDB = require('./config/db');
const { initializeSocket } = require('./config/socket');
const { runCleanupJob } = require('./jobs/cleanup.job');

async function bootstrap() {
  await connectDB();

  const server = http.createServer(app);
  initializeSocket(server);

  runCleanupJob().catch((error) => {
    console.error('Cleanup job failed', error);
  });

  server.listen(env.port, () => {
    console.log(`${env.appName} listening on port ${env.port}`);
  });
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap server', error);
  process.exit(1);
});
