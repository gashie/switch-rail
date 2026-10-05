import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { createBodySchema, listQuerySchema } from './schema.js';
import { createSplitModel } from './model.js';
import { createSplitService } from './service.js';
import { createSplitController } from './controller.js';

const model = createSplitModel();
const service = createSplitService({ db, model });
const controller = createSplitController({ service });

const router = Router();

router.post('/', requireAuth, validateBody(createBodySchema), asyncHandler(controller.create));
router.get('/', requireAuth, validateQuery(listQuerySchema), asyncHandler(controller.list));
router.get('/:splitNumber/legs', requireAuth, asyncHandler(controller.listLegs));
router.get('/:splitNumber', requireAuth, asyncHandler(controller.getByNumber));

export { router as default, service, model };
