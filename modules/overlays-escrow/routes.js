import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import {
  createBodySchema,
  signBodySchema,
  arbiterReleaseBodySchema,
  refundBodySchema,
  listQuerySchema
} from './schema.js';
import { createEscrowModel } from './model.js';
import { createEscrowService } from './service.js';
import { createEscrowController } from './controller.js';

const model = createEscrowModel();
const service = createEscrowService({ db, model });
const controller = createEscrowController({ service });

const router = Router();

router.post('/', requireAuth, validateBody(createBodySchema), asyncHandler(controller.create));
router.get('/', requireAuth, validateQuery(listQuerySchema), asyncHandler(controller.list));
router.post('/tick', requireAuth, asyncHandler(controller.tick));
router.post(
  '/:escrowNumber/sign',
  requireAuth,
  validateBody(signBodySchema),
  asyncHandler(controller.sign)
);
router.post('/:escrowNumber/payer-release', requireAuth, asyncHandler(controller.payerRelease));
router.post(
  '/:escrowNumber/arbiter-release',
  requireAuth,
  validateBody(arbiterReleaseBodySchema),
  asyncHandler(controller.arbiterRelease)
);
router.post(
  '/:escrowNumber/refund',
  requireAuth,
  validateBody(refundBodySchema),
  asyncHandler(controller.refund)
);
router.post('/:escrowNumber/cancel', requireAuth, asyncHandler(controller.cancel));
router.get('/:escrowNumber', requireAuth, asyncHandler(controller.getByNumber));

export { router as default, service, model };
