import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../../core/config.js';
import { attachContext } from '../../core/context.js';
import { errorHandler, sendOk } from '../../core/http.js';
import reconRoutes from './routes.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(config.cookieSecret));
app.use(attachContext);
app.get('/health', (_req, res) => sendOk(res, { module: 'reconciliation', status: 'up' }));
app.use('/reconciliation', reconRoutes);
app.use(errorHandler);

app.listen(config.reconciliationPort, () =>
  console.log(`reconciliation on ${config.reconciliationPort}`)
);
