import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../../core/config.js';
import { attachContext } from '../../core/context.js';
import { errorHandler, sendOk } from '../../core/http.js';
import envelopeRoutes from './routes.js';

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser(config.cookieSecret));
app.use(attachContext);
app.get('/health', (_req, res) => sendOk(res, { module: 'envelope', status: 'up' }));
app.use('/envelope', envelopeRoutes);
app.use(errorHandler);

app.listen(config.envelopePort, () => console.log(`envelope on ${config.envelopePort}`));
