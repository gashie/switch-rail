import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../../core/config.js';
import { attachContext } from '../../core/context.js';
import { errorHandler, sendOk } from '../../core/http.js';
import aliasesRoutes from './routes.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(config.cookieSecret));
app.use(attachContext);
app.get('/health', (_req, res) => sendOk(res, { module: 'aliases', status: 'up' }));
app.use('/aliases', aliasesRoutes);
app.use(errorHandler);

app.listen(config.aliasesPort, () => console.log(`aliases on ${config.aliasesPort}`));
