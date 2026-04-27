import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../../core/config.js';
import { attachContext } from '../../core/context.js';
import { errorHandler, sendOk } from '../../core/http.js';
import directoryRoutes from './routes.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(config.cookieSecret));
app.use(attachContext);
app.get('/health', (_req, res) => sendOk(res, { module: 'directory', status: 'up' }));
app.use('/directory', directoryRoutes);
app.use(errorHandler);

app.listen(config.directoryPort, () =>
  console.log(`directory on ${config.directoryPort}`)
);
