import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../../core/config.js';
import { attachContext } from '../../core/context.js';
import { errorHandler, sendOk } from '../../core/http.js';
import cycleRoutes from './routes.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(config.cookieSecret));
app.use(attachContext);
app.get('/health', (_req, res) => sendOk(res, { module: 'settlement-cycle', status: 'up' }));
app.use('/settlement-cycle', cycleRoutes);
app.use(errorHandler);

app.listen(config.settlementCyclePort, () =>
  console.log(`settlement-cycle on ${config.settlementCyclePort}`)
);
