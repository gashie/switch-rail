import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../../core/config.js';
import { attachContext } from '../../core/context.js';
import { errorHandler, sendOk } from '../../core/http.js';
import railsRoutes, { simulatorRouter } from './routes.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(config.cookieSecret));
app.use(attachContext);
app.get('/health', (_req, res) => sendOk(res, { module: 'crossborder-rails', status: 'up' }));
app.use('/crossborder-rails', railsRoutes);
app.use('/simulator-foreign', simulatorRouter);
app.use(errorHandler);

app.listen(config.crossborderRailsPort, () =>
  console.log(`crossborder-rails on ${config.crossborderRailsPort}`)
);
