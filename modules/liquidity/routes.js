import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import {
  limitsBodySchema,
  topupBodySchema,
  listLimitsQuerySchema,
  listTopupsQuerySchema
} from './schema.js';
import { createLiquidityModel } from './model.js';
import { createLiquidityService } from './service.js';
import { createLiquidityController } from './controller.js';

const model = createLiquidityModel();
const service = createLiquidityService({ db, model });
const controller = createLiquidityController({ service });

const router = Router();

router.get('/limits', requireAuth, validateQuery(listLimitsQuerySchema), asyncHandler(controller.listLimits));
router.put(
  '/limits/:participantCode/:currency',
  requireAuth,
  validateBody(limitsBodySchema),
  asyncHandler(controller.putLimits)
);
router.post('/topup', requireAuth, validateBody(topupBodySchema), asyncHandler(controller.topup));
router.get('/topups', requireAuth, validateQuery(listTopupsQuerySchema), asyncHandler(controller.listTopups));

export { router as default, service, model };
