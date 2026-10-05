import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import {
  registerBodySchema,
  findQuerySchema,
  listQuerySchema,
  simulatorQuoteBodySchema,
  simulatorInstructBodySchema,
  simulatorStatusBodySchema,
  simulatorFreezeBodySchema,
  simulatorReverseBodySchema
} from './schema.js';
import { createForeignRailsModel } from './model.js';
import { createForeignRailsService } from './service.js';
import { createSimulatorService } from './simulator.js';
import { createForeignRailsController } from './controller.js';

const model = createForeignRailsModel();
const service = createForeignRailsService({ db, model });
const simulator = createSimulatorService();
const controller = createForeignRailsController({ service, simulator });

const router = Router();

// Foreign-rail registry routes (admin / participants).
router.post('/', requireAuth, validateBody(registerBodySchema), asyncHandler(controller.register));
router.get('/', requireAuth, validateQuery(listQuerySchema), asyncHandler(controller.list));
router.get('/find', requireAuth, validateQuery(findQuerySchema), asyncHandler(controller.find));
router.post('/:code/active', requireAuth, asyncHandler(controller.setActive));
router.get('/:code', requireAuth, asyncHandler(controller.getByCode));

// Simulator routes — UNAUTHENTICATED. They are the dev/test reference
// implementation of the foreign-rail HTTP contract; production replaces
// these with mTLS-secured PAPSS adapters, just like the participant
// simulator's deliberate auth-bypass.
const simRouter = Router();
simRouter.post(
  '/:railCode/quote',
  validateBody(simulatorQuoteBodySchema),
  asyncHandler(controller.simQuote)
);
simRouter.post(
  '/:railCode/instruct',
  validateBody(simulatorInstructBodySchema),
  asyncHandler(controller.simInstruct)
);
simRouter.post(
  '/:railCode/status',
  validateBody(simulatorStatusBodySchema),
  asyncHandler(controller.simStatus)
);
simRouter.post(
  '/:railCode/freeze',
  validateBody(simulatorFreezeBodySchema),
  asyncHandler(controller.simFreeze)
);
simRouter.post(
  '/:railCode/reverse',
  validateBody(simulatorReverseBodySchema),
  asyncHandler(controller.simReverse)
);

export { router as default, simRouter as simulatorRouter, service, model, simulator };
