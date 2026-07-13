/**
 * local server entry file, for local development
 */
import app from './app.js';
import { closeDatabase } from './db.js';

/**
 * start server with port
 */
const HOST = process.env.HOST || "0.0.0.0";
const PORT = process.env.PORT || 3001;

const server = app.listen(Number(PORT), HOST, () => {
  console.log(`Server ready on ${HOST}:${PORT}`);
});

/**
 * close server
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received');
  server.close(async () => {
    await closeDatabase();
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received');
  server.close(async () => {
    await closeDatabase();
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;
