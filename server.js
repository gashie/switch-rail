import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './core/config.js';
import { attachContext } from './core/context.js';
import { errorHandler, sendOk } from './core/http.js';
import { authRoutes } from './modules/auth/index.js';
import { auditRoutes } from './modules/audit/index.js';
import { cryptoKeysRoutes } from './modules/crypto-keys/index.js';
import { envelopeRoutes } from './modules/envelope/index.js';
import { restRoutes } from './modules/adapters-rest/index.js';
import { iso20022Routes } from './modules/adapters-iso20022/index.js';
import { iso8583Routes } from './modules/adapters-iso8583/index.js';
import { swiftRoutes } from './modules/adapters-swift/index.js';
import { bulkRoutes } from './modules/adapters-bulk/index.js';
import { participantsRoutes } from './modules/participants/index.js';
import { participantOnboardingRoutes } from './modules/participant-onboarding/index.js';
import { directoryRoutes } from './modules/directory/index.js';
import { aliasesRoutes } from './modules/aliases/index.js';
import { nameEnquiryRoutes } from './modules/name-enquiry/index.js';
import { transactionsRoutes } from './modules/transactions/index.js';
import { routingRoutes } from './modules/routing/index.js';
import { participantSimulatorRoutes } from './modules/participant-simulator/index.js';
import { creditLegRoutes } from './modules/credit-leg/index.js';
import { transactionReceiptsRoutes } from './modules/transaction-receipts/index.js';
import { transactionRecoveryWorker } from './modules/transaction-recovery/index.js';

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser(config.cookieSecret));
app.use(attachContext);

app.get('/health', (_req, res) =>
  sendOk(res, {
    operatorName: config.operatorName,
    countryCode: config.countryCode,
    currencyDefault: config.currencyDefault,
    status: 'up'
  })
);

app.use('/auth', authRoutes);
app.use('/audit', auditRoutes);
app.use('/crypto-keys', cryptoKeysRoutes);
app.use('/envelope', envelopeRoutes);
app.use('/adapters-rest', restRoutes);
app.use('/adapters-iso20022', iso20022Routes);
app.use('/adapters-iso8583', iso8583Routes);
app.use('/adapters-swift', swiftRoutes);
app.use('/adapters-bulk', bulkRoutes);
app.use('/participants', participantsRoutes);
app.use('/participant-onboarding', participantOnboardingRoutes);
app.use('/directory', directoryRoutes);
app.use('/aliases', aliasesRoutes);
app.use('/name-enquiry', nameEnquiryRoutes);
app.use('/transactions', transactionsRoutes);
app.use('/routing', routingRoutes);
app.use('/simulator', participantSimulatorRoutes);
app.use('/credit-leg', creditLegRoutes);
app.use('/transaction-receipts', transactionReceiptsRoutes);
app.use(errorHandler);

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
