import { Router } from 'express';
import { asyncHandler, validateBody } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { createPublicStatusModel } from './model.js';
import { createPublicStatusService } from './service.js';
import { createPublicStatusController } from './controller.js';
import {
  declareIncidentSchema, incidentUpdateSchema,
  resolveIncidentSchema, verifyReceiptSchema
} from './schema.js';

const model = createPublicStatusModel();
const service = createPublicStatusService({ db, model });
const controller = createPublicStatusController({ service });

const router = Router();

// Public reads — no auth.
router.get('/summary', asyncHandler(controller.publicSummary));
router.get('/incidents/:id/updates', asyncHandler(controller.publicIncident));
router.post('/verify-receipt', validateBody(verifyReceiptSchema), asyncHandler(controller.verifyReceipt));

// Operator mutations.
router.post('/incidents', requireAuth, validateBody(declareIncidentSchema), asyncHandler(controller.declare));
router.post('/incidents/:id/updates', requireAuth, validateBody(incidentUpdateSchema), asyncHandler(controller.update));
router.post('/incidents/:id/resolve', requireAuth, validateBody(resolveIncidentSchema), asyncHandler(controller.resolve));

export { router as default, service };
