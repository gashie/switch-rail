import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import {
  initiateBodySchema,
  completeBodySchema,
  cancelBodySchema,
  listQuerySchema
} from './schema.js';
import { createCashoutModel } from './model.js';
import { createCashoutService } from './service.js';
import { createCashoutController } from './controller.js';

const model = createCashoutModel();
const service = createCashoutService({ db, model });
const controller = createCashoutController({ service });

const router = Router();

router.post('/', requireAuth, validateBody(initiateBodySchema), asyncHandler(controller.initiate));
router.get('/', requireAuth, validateQuery(listQuerySchema), asyncHandler(controller.list));
router.post('/expire-past', requireAuth, asyncHandler(controller.expirePast));
router.post('/:requestNumber/authorize', requireAuth, asyncHandler(controller.authorize));
router.post(
  '/:requestNumber/complete',
  requireAuth,
  validateBody(completeBodySchema),
  asyncHandler(controller.complete)
);
router.post(
  '/:requestNumber/cancel',
  requireAuth,
  validateBody(cancelBodySchema),
  asyncHandler(controller.cancel)
);
router.get('/:requestNumber', requireAuth, asyncHandler(controller.getByNumber));

export { router as default, service, model };
