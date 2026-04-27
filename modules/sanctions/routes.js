import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import {
  screenBodySchema,
  upsertEntryBodySchema,
  listEntriesQuerySchema
} from './schema.js';
import { createSanctionsModel } from './model.js';
import { createSanctionsService } from './service.js';
import { createScreener } from './screener.js';
import { createSanctionsController } from './controller.js';

const model = createSanctionsModel();
const screener = createScreener({ model });
const service = createSanctionsService({ db, model, screener });
const controller = createSanctionsController({ service });

const router = Router();

router.get('/entries', requireAuth, validateQuery(listEntriesQuerySchema), asyncHandler(controller.listEntries));
router.post('/entries', requireAuth, validateBody(upsertEntryBodySchema), asyncHandler(controller.upsertEntry));
router.delete('/entries/:id', requireAuth, asyncHandler(controller.removeEntry));
router.post('/screen', requireAuth, validateBody(screenBodySchema), asyncHandler(controller.screen));

export { router as default, service, model, screener };
