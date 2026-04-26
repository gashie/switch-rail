import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../../core/config.js';
import { attachContext } from '../../core/context.js';
import { errorHandler, sendOk } from '../../core/http.js';
import iso20022Routes from './routes.js';

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser(config.cookieSecret));
app.use(attachContext);
app.get('/health', (_req, res) => sendOk(res, { module: 'adapters-iso20022', status: 'up' }));
app.use('/iso20022', iso20022Routes);
app.use(errorHandler);

app.listen(config.adaptersIso20022Port, () =>
  console.log(`adapters-iso20022 on ${config.adaptersIso20022Port}`)
);
