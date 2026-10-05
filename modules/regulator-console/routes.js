import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { createRegulatorConsoleModel } from './model.js';
import { createRegulatorConsoleService } from './service.js';
import { createRegulatorConsoleController } from './controller.js';
import { dailyDigestSchema, exportLogSchema } from './schema.js';

const model = createRegulatorConsoleModel();
const service = createRegulatorConsoleService({ db, model });
const controller = createRegulatorConsoleController({ service });

const router = Router();

router.get('/digest', requireAuth, validateQuery(dailyDigestSchema), asyncHandler(controller.digest));
router.post('/exports', requireAuth, validateBody(exportLogSchema), asyncHandler(controller.logExport));
router.get('/exports', requireAuth, asyncHandler(controller.listExports));

export { router as default, service };
