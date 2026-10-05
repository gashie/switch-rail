import { Router } from 'express';
import expressFileUpload from 'express-fileupload';
import { asyncHandler } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { envelopeService } from '../envelope/index.js';
import { createBulkModel } from './model.js';
import { createBulkService } from './service.js';
import { createBulkController } from './controller.js';

const model = createBulkModel();
const service = createBulkService({ db, model, envelope: envelopeService });
const controller = createBulkController({ service });

const fileUpload = expressFileUpload({ limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();

router.post('/csv', requireAuth, fileUpload, asyncHandler(controller.csv));
router.post('/xlsx', requireAuth, fileUpload, asyncHandler(controller.xlsx));
router.post('/pain001', requireAuth, fileUpload, asyncHandler(controller.pain001));
router.get('/batches/:batchId', requireAuth, asyncHandler(controller.getBatch));

export { router as default, service };
