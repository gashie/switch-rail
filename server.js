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
app.use(errorHandler);

app.listen(config.port, () =>
  console.log(`${config.operatorName} rail on :${config.port}`)
);
