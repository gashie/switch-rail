import { Router } from 'express';
import { asyncHandler, validateBody } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { ingestBodySchema } from './schema.js';
import { createCrossborderTxModel } from './model.js';
import { createCoordinator } from './coordinator.js';
import { createRecoveryWorker } from './recovery-worker.js';
import { createCrossborderTxController } from './controller.js';
import { registerCrossborderCoordinator } from '../transactions/index.js';

const model = createCrossborderTxModel();
const coordinator = createCoordinator({ db, model });
const recoveryWorker = createRecoveryWorker({ model });

// Wire the coordinator into the orchestrator's XB branch on module load.
registerCrossborderCoordinator(coordinator);

// Lightweight service wrapper around model lookups.
const service = {
  findById: (id) => db.withClient((c) => model.findById(c, id)),
  findByTxId: (txId) => db.withClient((c) => model.findByTxId(c, txId))
};

const controller = createCrossborderTxController({ service, recoveryWorker });

const router = Router();

router.post(
  '/quote-and-instruct',
  requireAuth,
  validateBody(ingestBodySchema),
  asyncHandler(controller.ingest)
);
router.post('/recovery/tick', requireAuth, asyncHandler(controller.tick));
router.get('/by-tx/:txId', requireAuth, asyncHandler(controller.getByTxId));
router.get('/:id', requireAuth, asyncHandler(controller.getById));

export { router as default, service, model, coordinator, recoveryWorker };
