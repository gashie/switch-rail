import express from 'express';
import { config } from '../../core/config.js';
import { attachContext } from '../../core/context.js';
import { errorHandler, sendOk } from '../../core/http.js';
import simulatorRoutes from './routes.js';

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(attachContext);
app.get('/health', (_req, res) =>
  sendOk(res, { module: 'participant-simulator', status: 'up' })
);
app.use('/simulator', simulatorRoutes);
app.use(errorHandler);

app.listen(config.participantSimulatorPort, () =>
  console.log(`participant-simulator on ${config.participantSimulatorPort}`)
);
