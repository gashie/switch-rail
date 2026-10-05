import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../../core/config.js';
import { attachContext } from '../../core/context.js';
import { errorHandler, sendOk } from '../../core/http.js';
import publicStatusRoutes from './routes.js';

const app = express();
app.use(express.json());
app.use(cookieParser(config.cookieSecret));
app.use(attachContext);
app.get('/health', (_req, res) => sendOk(res, { module: 'public-status', status: 'up' }));
app.use('/public-status', publicStatusRoutes);
app.use(errorHandler);

app.listen(config.publicStatusPort, () => console.log(`public-status on ${config.publicStatusPort}`));
