import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../../core/config.js';
import { attachContext } from '../../core/context.js';
import { errorHandler, sendOk } from '../../core/http.js';
import settlementRoutes from './routes.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(config.cookieSecret));
app.use(attachContext);
app.get('/health', (_req, res) => sendOk(res, { module: 'settlement', status: 'up' }));
app.use('/settlement', settlementRoutes);
app.use(errorHandler);

app.listen(config.settlementPort, () =>
  console.log(`settlement on ${config.settlementPort}`)
);
