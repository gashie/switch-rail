import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { listQuerySchema, recomputeBodySchema } from './schema.js';
import { createPositionsModel } from './positions-model.js';
import { createPositionsService } from './positions-service.js';
import { createSettlementController } from './controller.js';

const model = createPositionsModel();
const service = createPositionsService({ db, model });
const controller = createSettlementController({ service });

const router = Router();

router.get('/positions', requireAuth, validateQuery(listQuerySchema), asyncHandler(controller.list));
router.get('/positions/:participantCode', requireAuth, asyncHandler(controller.forParticipant));
router.post('/positions/recompute', requireAuth, validateBody(recomputeBodySchema), asyncHandler(controller.recompute));

export { router as default, service, model };
