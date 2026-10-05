import { config } from './core/config.js';
import { buildApp } from './app.js';
import { transactionRecoveryWorker } from './modules/transaction-recovery/index.js';

const app = buildApp();

const server = app.listen(config.port, () => {
  console.log(`${config.operatorName} rail on :${config.port}`);
  transactionRecoveryWorker.start();
});

const shutdown = async (signal) => {
  console.log(`received ${signal}, shutting down`);
  await transactionRecoveryWorker.stop();
  server.close(() => process.exit(0));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
