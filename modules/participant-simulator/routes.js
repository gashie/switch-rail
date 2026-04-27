import { Router } from 'express';
import { asyncHandler, validateBody } from '../../core/http.js';
import * as db from '../../core/db.js';
import {
  creditLegBodySchema,
  statusCheckBodySchema,
  reversalBodySchema,
  overrideBodySchema
} from './schema.js';
import { createSimulatorModel } from './model.js';
import { createSimulatorService } from './service.js';
import { createSimulatorController } from './controller.js';

const model = createSimulatorModel();
const service = createSimulatorService({ db, model });
const controller = createSimulatorController({ service });

const router = Router();

// The simulator endpoints are deliberately UNAUTHENTICATED inside the rail
// process: they are the dev/test reference implementation of the real
// participant HTTP contract, which itself is mTLS-secured at the network
// edge in production. Adding requireAuth here would defeat the whole point
// — credit-leg-as-rail must be able to call them without holding a session
// cookie.
router.post(
  '/:participantCode/credit-leg',
  validateBody(creditLegBodySchema),
  asyncHandler(controller.creditLeg)
);
router.post(
  '/:participantCode/status-check',
  validateBody(statusCheckBodySchema),
  asyncHandler(controller.statusCheck)
);
router.post(
  '/:participantCode/reversal',
  validateBody(reversalBodySchema),
  asyncHandler(controller.reversal)
);
router.post('/overrides', validateBody(overrideBodySchema), asyncHandler(controller.upsertOverride));
router.get('/overrides', asyncHandler(controller.listOverrides));

export { router as default, service };
