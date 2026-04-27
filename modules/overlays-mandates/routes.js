import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import {
  createBodySchema,
  presentDebitBodySchema,
  revokeBodySchema,
  pauseBodySchema,
  listQuerySchema
} from './schema.js';
import { createMandatesModel } from './model.js';
import { createMandatesService } from './service.js';
import { createSchedulerWorker } from './scheduler-worker.js';
import { createMandatesController } from './controller.js';

const model = createMandatesModel();
const service = createMandatesService({ db, model });
const schedulerWorker = createSchedulerWorker({ service });
const controller = createMandatesController({ service, schedulerWorker });

const router = Router();

router.post('/', requireAuth, validateBody(createBodySchema), asyncHandler(controller.create));
router.get('/', requireAuth, validateQuery(listQuerySchema), asyncHandler(controller.list));
router.post('/scheduler/tick', requireAuth, asyncHandler(controller.schedulerTick));
router.post(
  '/:mandateNumber/debits',
  requireAuth,
  validateBody(presentDebitBodySchema),
  asyncHandler(controller.presentDebit)
);
router.get('/:mandateNumber/debits', requireAuth, asyncHandler(controller.listDebits));
router.post(
  '/:mandateNumber/revoke',
  requireAuth,
  validateBody(revokeBodySchema),
  asyncHandler(controller.revoke)
);
router.post(
  '/:mandateNumber/pause',
  requireAuth,
  validateBody(pauseBodySchema),
  asyncHandler(controller.pause)
);
router.post('/:mandateNumber/resume', requireAuth, asyncHandler(controller.resume));
router.get('/:mandateNumber', requireAuth, asyncHandler(controller.getByNumber));

export { router as default, service, model, schedulerWorker };
