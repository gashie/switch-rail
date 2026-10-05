import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import {
  flagBodySchema,
  withdrawBodySchema,
  listActiveQuerySchema
} from './schema.js';
import { createFlagsModel } from './model.js';
import { createFlagsService } from './service.js';
import { createFlagsController } from './controller.js';

const model = createFlagsModel();
const service = createFlagsService({ db, model });
const controller = createFlagsController({ service });

const router = Router();

// In production these endpoints are mTLS-only — participants directly call
// them. The HTTP-cookie auth here is a stand-in for the dev/test path.
router.post('/', requireAuth, validateBody(flagBodySchema), asyncHandler(controller.flag));
router.post('/:id/withdraw', requireAuth, validateBody(withdrawBodySchema), asyncHandler(controller.withdraw));
router.get('/active', requireAuth, validateQuery(listActiveQuerySchema), asyncHandler(controller.listActive));

export { router as default, service, model };
