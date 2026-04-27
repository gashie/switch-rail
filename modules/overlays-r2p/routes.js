import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import {
  createBodySchema,
  authorizeBodySchema,
  rejectBodySchema,
  listQuerySchema
} from './schema.js';
import { createR2pModel } from './model.js';
import { createR2pService } from './service.js';
import { createR2pController } from './controller.js';

const model = createR2pModel();
const service = createR2pService({ db, model });
const controller = createR2pController({ service });

const router = Router();

router.post('/', requireAuth, validateBody(createBodySchema), asyncHandler(controller.create));
router.get('/', requireAuth, validateQuery(listQuerySchema), asyncHandler(controller.list));
router.post(
  '/:requestNumber/authorize',
  requireAuth,
  validateBody(authorizeBodySchema),
  asyncHandler(controller.authorize)
);
router.post(
  '/:requestNumber/reject',
  requireAuth,
  validateBody(rejectBodySchema),
  asyncHandler(controller.reject)
);
router.post('/expire-pending', requireAuth, asyncHandler(controller.expirePending));
router.get('/:requestNumber', requireAuth, asyncHandler(controller.getByNumber));

export { router as default, service, model };
