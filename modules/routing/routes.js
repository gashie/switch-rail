import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import {
  addRuleSchema,
  listQuerySchema,
  resolveBodySchema
} from './schema.js';
import { createRoutingModel } from './model.js';
import { createRoutingService } from './service.js';
import { createRoutingController } from './controller.js';

const model = createRoutingModel();
const service = createRoutingService({ db, model });
const controller = createRoutingController({ service });

const router = Router();

router.get('/rules', requireAuth, validateQuery(listQuerySchema), asyncHandler(controller.listRules));
router.post('/rules', requireAuth, validateBody(addRuleSchema), asyncHandler(controller.addRule));
router.delete('/rules/:id', requireAuth, asyncHandler(controller.removeRule));
router.post('/reload', requireAuth, asyncHandler(controller.reload));
router.post('/resolve', requireAuth, validateBody(resolveBodySchema), asyncHandler(controller.resolve));

export { router as default, service };
