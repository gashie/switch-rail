import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../../core/config.js';
import { attachContext } from '../../core/context.js';
import { errorHandler, sendOk } from '../../core/http.js';
import eodRoutes from './routes.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(config.cookieSecret));
app.use(attachContext);
app.get('/health', (_req, res) => sendOk(res, { module: 'eod', status: 'up' }));
app.use('/eod', eodRoutes);
app.use(errorHandler);

app.listen(config.eodPort, () =>
  console.log(`eod on ${config.eodPort}`)
);
