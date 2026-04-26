import express from 'express';
import cookieParser from 'cookie-parser';
import expressFileUpload from 'express-fileupload';
import { config } from './core/config.js';
import { attachContext } from './core/context.js';
import { errorHandler, sendOk } from './core/http.js';
import { authRoutes } from './modules/auth/index.js';
import { auditRoutes } from './modules/audit/index.js';
import { cryptoKeysRoutes } from './modules/crypto-keys/index.js';

const app = express();
app.use(express.json());
app.use(cookieParser(config.cookieSecret));
app.use(expressFileUpload());
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
app.use(errorHandler);

app.listen(config.port, () =>
  console.log(`${config.operatorName} rail on :${config.port}`)
);
