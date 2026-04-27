import { Router } from 'express';
import expressFileUpload from 'express-fileupload';
import { asyncHandler, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { listQuerySchema } from './schema.js';
import { createBulkModel } from './model.js';
import { createOverlaysBulkService } from './service.js';
import { createOverlaysBulkController } from './controller.js';
import { createRunnerWorker } from './runner-worker.js';

const model = createBulkModel();
const service = createOverlaysBulkService({ db, model });
const runnerWorker = createRunnerWorker({ service, model });
const controller = createOverlaysBulkController({ service });

const fileUpload = expressFileUpload({ limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();

router.post('/runs', requireAuth, fileUpload, asyncHandler(controller.upload));
router.get('/runs', requireAuth, validateQuery(listQuerySchema), asyncHandler(controller.list));
router.get('/runs/:runNumber', requireAuth, asyncHandler(controller.getRun));
router.get('/runs/:runNumber/lines', requireAuth, asyncHandler(controller.listLines));
router.post('/runs/:runNumber/run', requireAuth, asyncHandler(controller.runBatch));

export { router as default, service, model, runnerWorker };
