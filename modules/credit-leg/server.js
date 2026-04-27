import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../../core/config.js';
import { attachContext } from '../../core/context.js';
import { errorHandler, sendOk } from '../../core/http.js';
import creditLegRoutes from './routes.js';

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser(config.cookieSecret));
app.use(attachContext);
app.get('/health', (_req, res) => sendOk(res, { module: 'credit-leg', status: 'up' }));
app.use('/credit-leg', creditLegRoutes);
app.use(errorHandler);

app.listen(config.creditLegPort, () =>
  console.log(`credit-leg on ${config.creditLegPort}`)
);
