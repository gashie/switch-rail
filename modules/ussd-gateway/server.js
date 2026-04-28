import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../../core/config.js';
import { attachContext } from '../../core/context.js';
import { errorHandler, sendOk } from '../../core/http.js';
import ussdGatewayRoutes from './routes.js';

const app = express();
app.use(express.json());
app.use(cookieParser(config.cookieSecret));
app.use(attachContext);
app.get('/health', (_req, res) => sendOk(res, { module: 'ussd-gateway', status: 'up' }));
app.use('/ussd', ussdGatewayRoutes);
app.use(errorHandler);

app.listen(config.ussdGatewayPort, () => console.log(`ussd-gateway on ${config.ussdGatewayPort}`));
