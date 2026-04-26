import { Router } from 'express';
import { asyncHandler, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { createAuditModel } from './model.js';
import { createAuditService } from './service.js';
import { createAuditController } from './controller.js';
import { listQuerySchema, verifyDaySchema } from './schema.js';

const model = createAuditModel();
const service = createAuditService({ db, model });
const controller = createAuditController({ service });

const router = Router();

router.get('/', requireAuth, validateQuery(listQuerySchema), asyncHandler(controller.list));
router.get('/verify', requireAuth, validateQuery(verifyDaySchema), asyncHandler(controller.verifyDay));

export { router as default, service };
