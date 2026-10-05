import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { initiateBodySchema, listQuerySchema } from './schema.js';
import { createRefundsModel } from './model.js';
import { createRefundsService } from './service.js';
import { createRefundsController } from './controller.js';

const model = createRefundsModel();
const service = createRefundsService({ db, model });
const controller = createRefundsController({ service });

const router = Router();

router.post('/', requireAuth, validateBody(initiateBodySchema), asyncHandler(controller.initiate));
router.get('/', requireAuth, validateQuery(listQuerySchema), asyncHandler(controller.list));
router.get('/by-original/:originalTxId', requireAuth, asyncHandler(controller.listForOriginal));
router.get('/:refundNumber/verify-signature', requireAuth, asyncHandler(controller.verifySignature));
router.get('/:refundNumber', requireAuth, asyncHandler(controller.getByNumber));

export { router as default, service, model };
