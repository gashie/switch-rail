import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../../core/config.js';
import { attachContext } from '../../core/context.js';
import { errorHandler, sendOk } from '../../core/http.js';
import cryptoKeysRoutes from './routes.js';

const app = express();
app.use(express.json());
app.use(cookieParser(config.cookieSecret));
app.use(attachContext);
app.get('/health', (_req, res) => sendOk(res, { module: 'crypto-keys', status: 'up' }));
app.use('/crypto-keys', cryptoKeysRoutes);
app.use(errorHandler);

app.listen(config.cryptoKeysPort, () => console.log(`crypto-keys on ${config.cryptoKeysPort}`));
