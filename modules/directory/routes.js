import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { registerSchema, listQuerySchema, searchQuerySchema } from './schema.js';
import { createDirectoryModel } from './model.js';
import { createDirectoryService } from './service.js';
import { createDirectoryController } from './controller.js';

const model = createDirectoryModel();
const service = createDirectoryService({ db, model });
const controller = createDirectoryController({ service });

const router = Router();

router.post('/accounts', requireAuth, validateBody(registerSchema), asyncHandler(controller.register));
router.get('/accounts', requireAuth, validateQuery(listQuerySchema), asyncHandler(controller.list));
router.get('/accounts/search', requireAuth, validateQuery(searchQuerySchema), asyncHandler(controller.search));
router.get('/accounts/:participantCode/:accountNumber', requireAuth, asyncHandler(controller.getByAccount));
router.post('/accounts/:participantCode/:accountNumber/freeze', requireAuth, asyncHandler(controller.freeze));
router.post('/accounts/:participantCode/:accountNumber/unfreeze', requireAuth, asyncHandler(controller.unfreeze));
router.post('/accounts/:participantCode/:accountNumber/close', requireAuth, asyncHandler(controller.close));

export { router as default, service };
