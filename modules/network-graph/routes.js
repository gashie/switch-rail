import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import {
  listAlertsQuerySchema,
  resolveAlertBodySchema,
  scanBodySchema
} from './schema.js';
import { createEdgesModel } from './edges-model.js';
import { createEdgesService } from './edges-service.js';
import { createAlertsModel } from './alerts-model.js';
import { createAlertsService } from './alerts-service.js';
import { createScannerWorker } from './scanner-worker.js';
import { createGraphController } from './controller.js';

const edgesModel = createEdgesModel();
const edgesService = createEdgesService({ db, model: edgesModel });
const alertsModel = createAlertsModel();
const alertsService = createAlertsService({ db, alertsModel, edgesModel });
const scannerWorker = createScannerWorker({ alertsService });
const controller = createGraphController({ edgesService, alertsService });

const router = Router();

router.get('/edges/:accountKey', requireAuth, asyncHandler(controller.edgesFor));
router.get('/alerts', requireAuth, validateQuery(listAlertsQuerySchema), asyncHandler(controller.listAlerts));
router.get('/alerts/:id', requireAuth, asyncHandler(controller.getAlert));
router.post('/alerts/:id/resolve', requireAuth, validateBody(resolveAlertBodySchema), asyncHandler(controller.resolveAlert));
router.post('/scan', requireAuth, validateBody(scanBodySchema), asyncHandler(controller.scan));

export {
  router as default,
  edgesService,
  edgesModel,
  alertsService,
  alertsModel,
  scannerWorker
};
