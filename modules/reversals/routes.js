import { Router } from 'express';
import { asyncHandler, validateBody } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { initiateBodySchema } from './schema.js';
import { createReversalsModel } from './model.js';
import { createReversalsService } from './service.js';
import { createReversalsController } from './controller.js';

const model = createReversalsModel();
const service = createReversalsService({ db, model });
const controller = createReversalsController({ service });

const router = Router();

router.post('/', requireAuth, validateBody(initiateBodySchema), asyncHandler(controller.initiate));
router.get('/by-original/:originalTxId', requireAuth, asyncHandler(controller.listForOriginal));
router.get('/:id', requireAuth, asyncHandler(controller.getById));

export { router as default, service, model };
