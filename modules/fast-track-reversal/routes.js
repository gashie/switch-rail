import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { invokeBodySchema, listQuerySchema } from './schema.js';
import { createFTRModel } from './model.js';
import { createFastTrackService } from './service.js';
import { createFTRController } from './controller.js';

const model = createFTRModel();
const service = createFastTrackService({ db, model });
const controller = createFTRController({ service });

const router = Router();

router.post('/', requireAuth, validateBody(invokeBodySchema), asyncHandler(controller.invoke));
router.post('/:id/confirm-reversal', requireAuth, asyncHandler(controller.confirmReversal));
router.get('/', requireAuth, validateQuery(listQuerySchema), asyncHandler(controller.list));
router.get('/:id', requireAuth, asyncHandler(controller.getById));

export { router as default, service, model };
