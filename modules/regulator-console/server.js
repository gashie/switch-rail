import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../../core/config.js';
import { attachContext } from '../../core/context.js';
import { errorHandler, sendOk } from '../../core/http.js';
import regulatorConsoleRoutes from './routes.js';

const app = express();
app.use(express.json());
app.use(cookieParser(config.cookieSecret));
app.use(attachContext);
app.get('/health', (_req, res) => sendOk(res, { module: 'regulator-console', status: 'up' }));
app.use('/regulator-console', regulatorConsoleRoutes);
app.use(errorHandler);

app.listen(config.regulatorConsolePort, () => console.log(`regulator-console on ${config.regulatorConsolePort}`));
