import { Router } from 'express';
import { asyncHandler, validateBody } from '../../core/http.js';
import { requireAuth } from '../auth/index.js';
import { envelopeService, envelopeSchema } from '../envelope/index.js';
import { cryptoKeysService } from '../crypto-keys/index.js';
import { transactionsOrchestrator } from '../transactions/index.js';
import { createRestService } from './service.js';
import { createRestController } from './controller.js';

const service = createRestService({
  envelope: envelopeService,
  cryptoKeys: cryptoKeysService,
  orchestrator: transactionsOrchestrator
});
const controller = createRestController({ service });

const router = Router();

router.post('/inbound', requireAuth, validateBody(envelopeSchema), asyncHandler(controller.inbound));
router.post('/process', requireAuth, validateBody(envelopeSchema), asyncHandler(controller.process));
router.post('/outbound', requireAuth, validateBody(envelopeSchema), asyncHandler(controller.outbound));

export { router as default, service };
