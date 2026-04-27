import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { ingestSchema, killBodySchema, listQuerySchema } from './schema.js';
import { createTransactionsModel } from './model.js';
import { createTransactionsService } from './service.js';
import { createTransactionsController } from './controller.js';

const model = createTransactionsModel();
const service = createTransactionsService({ db, model });
const controller = createTransactionsController({ service });

const router = Router();

router.post('/ingest', requireAuth, validateBody(ingestSchema), asyncHandler(controller.ingest));
router.get('/', requireAuth, validateQuery(listQuerySchema), asyncHandler(controller.list));
router.get('/:id', requireAuth, asyncHandler(controller.getById));
router.get('/:id/history', requireAuth, asyncHandler(controller.getHistory));
router.post('/:id/kill', requireAuth, validateBody(killBodySchema), asyncHandler(controller.kill));

export { router as default, service, model };
