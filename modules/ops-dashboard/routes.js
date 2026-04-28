import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { createOpsDashboardModel } from './model.js';
import { createOpsDashboardService } from './service.js';
import { createOpsDashboardController } from './controller.js';
import { listSnapshotsSchema, recordSnapshotSchema, summarySchema } from './schema.js';

const model = createOpsDashboardModel();
const service = createOpsDashboardService({ db, model });
const controller = createOpsDashboardController({ service });

const router = Router();

router.get('/snapshots', requireAuth, validateQuery(listSnapshotsSchema), asyncHandler(controller.list));
router.post('/snapshots', requireAuth, validateBody(recordSnapshotSchema), asyncHandler(controller.record));
router.get('/summary', requireAuth, validateQuery(summarySchema), asyncHandler(controller.summary));

export { router as default, service };
