import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import {
  createCycleBodySchema,
  runCycleBodySchema,
  listQuerySchema
} from './schema.js';
import { createCycleModel } from './model.js';
import { createCycleService } from './service.js';
import { createCycleRunner } from './cycle-runner.js';
import { createCycleController } from './controller.js';

const model = createCycleModel();
const service = createCycleService({ db, model });
const runner = createCycleRunner({ db, cycleModel: model });
const controller = createCycleController({ service, runner });

const router = Router();

router.get('/cycles', requireAuth, validateQuery(listQuerySchema), asyncHandler(controller.list));
router.get('/cycles/:id', requireAuth, asyncHandler(controller.getById));
router.post('/cycles', requireAuth, validateBody(createCycleBodySchema), asyncHandler(controller.create));
router.post('/cycles/:id/run', requireAuth, validateBody(runCycleBodySchema), asyncHandler(controller.run));

export { router as default, service, model, runner };
