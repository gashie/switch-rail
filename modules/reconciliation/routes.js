import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { config } from '../../core/config.js';
import { requireAuth } from '../auth/index.js';
import {
  runBodySchema,
  listRunsQuerySchema,
  listBreaksQuerySchema,
  resolveBreakBodySchema
} from './schema.js';
import { createReconModel } from './model.js';
import { createReconService } from './service.js';
import { createParticipantFeedClient } from './feed-client.js';
import { createReconController } from './controller.js';

const model = createReconModel();
const feedClient = createParticipantFeedClient({ db, mode: config.reconFeedMode });
const service = createReconService({ db, model, feedClient });
const controller = createReconController({ service });

const router = Router();

router.get('/runs', requireAuth, validateQuery(listRunsQuerySchema), asyncHandler(controller.listRuns));
router.get('/runs/:id', requireAuth, asyncHandler(controller.getRun));
router.post('/runs', requireAuth, validateBody(runBodySchema), asyncHandler(controller.createRun));
router.get('/breaks', requireAuth, validateQuery(listBreaksQuerySchema), asyncHandler(controller.listBreaks));
router.post(
  '/breaks/:id/resolve',
  requireAuth,
  validateBody(resolveBreakBodySchema),
  asyncHandler(controller.resolve)
);

export { router as default, service, model, feedClient };
