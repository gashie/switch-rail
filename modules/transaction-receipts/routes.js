import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { listQuerySchema, verifyBodySchema } from './schema.js';
import { createReceiptsModel } from './model.js';
import { createReceiptsService } from './service.js';
import { createReceiptsController } from './controller.js';

const model = createReceiptsModel();
const service = createReceiptsService({ db, model });
const controller = createReceiptsController({ service });

const router = Router();

router.get('/by-transaction/:txId', requireAuth, asyncHandler(controller.byTransaction));
router.get('/', requireAuth, validateQuery(listQuerySchema), asyncHandler(controller.listForParticipant));
// Verify is a public endpoint — anyone holding the rail's public kid material
// must be able to validate a receipt without an authenticated session.
router.post('/verify', validateBody(verifyBodySchema), asyncHandler(controller.verify));

export { router as default, service, model };
