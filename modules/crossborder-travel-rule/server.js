import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../../core/config.js';
import { attachContext } from '../../core/context.js';
import { errorHandler, sendOk } from '../../core/http.js';
import trRoutes from './routes.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(config.cookieSecret));
app.use(attachContext);
app.get('/health', (_req, res) => sendOk(res, { module: 'crossborder-travel-rule', status: 'up' }));
app.use('/crossborder-travel-rule', trRoutes);
app.use(errorHandler);

app.listen(config.crossborderTravelRulePort, () =>
  console.log(`crossborder-travel-rule on ${config.crossborderTravelRulePort}`)
);
