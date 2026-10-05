import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import {
  publishScheduleBodySchema,
  calculateBodySchema,
  listSchedulesQuerySchema
} from './schema.js';
import { createFeesModel } from './model.js';
import { createFeesService } from './service.js';
import { createFeesController } from './controller.js';

const model = createFeesModel();
const service = createFeesService({ db, model });
const controller = createFeesController({ service });

const router = Router();

router.get('/schedules', requireAuth, validateQuery(listSchedulesQuerySchema), asyncHandler(controller.list));
router.post('/schedules', requireAuth, validateBody(publishScheduleBodySchema), asyncHandler(controller.publish));
router.get('/schedules/:code', requireAuth, asyncHandler(controller.getByCode));
router.post('/calculate', requireAuth, validateBody(calculateBodySchema), asyncHandler(controller.calculate));
router.get('/summary', requireAuth, asyncHandler(controller.summary));

export { router as default, service, model };
