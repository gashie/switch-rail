import { Router } from 'express';
import { asyncHandler, validateBody } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { cutoverBodySchema, verifyBodySchema } from './schema.js';
import { createEodModel } from './model.js';
import { createEodService } from './service.js';
import { createEodController } from './controller.js';

const model = createEodModel();
const service = createEodService({ db, model });
const controller = createEodController({ service });

const router = Router();

// Public verify endpoint comes before requireAuth-guarded routes so a
// counterparty holding the rail's public key can always check a statement.
router.post('/statements/verify', validateBody(verifyBodySchema), asyncHandler(controller.verify));
router.get('/days', requireAuth, asyncHandler(controller.listDays));
router.get('/days/:date', requireAuth, asyncHandler(controller.getDay));
router.post('/cutover', requireAuth, validateBody(cutoverBodySchema), asyncHandler(controller.cutover));
router.get('/statements/:date', requireAuth, asyncHandler(controller.listStatements));
router.get(
  '/statements/:date/:participantCode/:currency',
  requireAuth,
  asyncHandler(controller.getStatement)
);

export { router as default, service, model };
