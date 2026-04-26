import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../../core/config.js';
import { attachContext } from '../../core/context.js';
import { errorHandler, sendOk } from '../../core/http.js';
import iso8583Routes from './routes.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(config.cookieSecret));
app.use(attachContext);
app.get('/health', (_req, res) => sendOk(res, { module: 'adapters-iso8583', status: 'up' }));
app.use('/iso8583', iso8583Routes);
app.use(errorHandler);

app.listen(config.adaptersIso8583Port, () =>
  console.log(`adapters-iso8583 on ${config.adaptersIso8583Port}`)
);
