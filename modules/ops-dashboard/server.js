import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../../core/config.js';
import { attachContext } from '../../core/context.js';
import { errorHandler, sendOk } from '../../core/http.js';
import opsDashboardRoutes from './routes.js';

const app = express();
app.use(express.json());
app.use(cookieParser(config.cookieSecret));
app.use(attachContext);
app.get('/health', (_req, res) => sendOk(res, { module: 'ops-dashboard', status: 'up' }));
app.use('/ops-dashboard', opsDashboardRoutes);
app.use(errorHandler);

app.listen(config.opsDashboardPort, () => console.log(`ops-dashboard on ${config.opsDashboardPort}`));
