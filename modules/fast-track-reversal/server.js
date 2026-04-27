import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../../core/config.js';
import { attachContext } from '../../core/context.js';
import { errorHandler, sendOk } from '../../core/http.js';
import fastTrackRoutes from './routes.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(config.cookieSecret));
app.use(attachContext);
app.get('/health', (_req, res) => sendOk(res, { module: 'fast-track-reversal', status: 'up' }));
app.use('/fast-track-reversal', fastTrackRoutes);
app.use(errorHandler);

app.listen(config.fastTrackReversalPort, () =>
  console.log(`fast-track-reversal on ${config.fastTrackReversalPort}`)
);
