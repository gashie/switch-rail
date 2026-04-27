import { Router } from 'express';
import expressFileUpload from 'express-fileupload';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import {
  fileBodySchema,
  listQuerySchema,
  killBodySchema
} from './schema.js';
import { createDisputesModel } from './model.js';
import { createDisputesService } from './service.js';
import { createDisputesController } from './controller.js';
import { createAutoValidator } from './auto-validator.js';
import { createReserveHolder } from './reserve-holder.js';
import { createEvidenceModel } from './evidence-model.js';
import { createEvidenceService } from './evidence-service.js';
import { createEvidenceController } from './evidence-controller.js';
import { createDecisionModel } from './decision-model.js';
import { createDecisionService } from './decision-service.js';
import { createDecisionController } from './decision-controller.js';
import { decisionBodySchema } from './schema.js';
import { registerDefaultRunners } from './auto-resolver.js';

// Register the four real B7.4 auto-resolver runners on module load. Each is a
// deterministic check against existing data (fast-track-reversal, duplicate
// transactions, reconciliation breaks, CoP override audit trail). Module
// load is at app boot, so this fires once and registers for the process.
registerDefaultRunners().catch((e) => {
  // Logged but not thrown — boot must not block on a runner-import failure;
  // subsequent processFiled calls will simply fall through to manual.
  console.error('[disputes] failed to register default auto-resolver runners', e);
});

const model = createDisputesModel();
const evidenceModel = createEvidenceModel();
const decisionModel = createDecisionModel();
const autoValidator = createAutoValidator({ model });
const reserveHolder = createReserveHolder({ model });
const service = createDisputesService({
  db,
  model,
  decisionModel,
  autoValidator,
  reserveHolder
});
const evidenceService = createEvidenceService({
  db,
  evidenceModel,
  casesModel: model,
  disputesService: service
});
const decisionService = createDecisionService({
  db,
  decisionModel,
  casesModel: model,
  evidenceModel,
  disputesService: service
});
const controller = createDisputesController({ service });
const evidenceController = createEvidenceController({ evidenceService });
const decisionController = createDecisionController({ decisionService });

const fileUpload = expressFileUpload({ limits: { fileSize: 25 * 1024 * 1024 } });

const router = Router();

router.post('/', requireAuth, validateBody(fileBodySchema), asyncHandler(controller.file));
router.get('/', requireAuth, validateQuery(listQuerySchema), asyncHandler(controller.list));
router.get('/transaction/:txId', requireAuth, asyncHandler(controller.listForTransaction));
router.get('/:caseNumber', requireAuth, asyncHandler(controller.getByCaseNumber));
router.get('/:caseNumber/history', requireAuth, asyncHandler(controller.history));
router.post('/:caseNumber/process', requireAuth, asyncHandler(controller.process));
router.post(
  '/:caseNumber/evidence',
  requireAuth,
  fileUpload,
  asyncHandler(evidenceController.upload)
);
router.get('/:caseNumber/evidence', requireAuth, asyncHandler(evidenceController.list));
router.get(
  '/:caseNumber/evidence/:id/verify-signature',
  requireAuth,
  asyncHandler(evidenceController.signaturePayload)
);
router.get(
  '/:caseNumber/evidence/verify-chain',
  requireAuth,
  asyncHandler(evidenceController.verifyChain)
);
router.post('/:id/kill', requireAuth, validateBody(killBodySchema), asyncHandler(controller.kill));
router.post(
  '/:id/expire-evidence-window',
  requireAuth,
  asyncHandler(evidenceController.expireWindow)
);
router.post(
  '/:caseNumber/decisions',
  requireAuth,
  validateBody(decisionBodySchema),
  asyncHandler(decisionController.decide)
);
router.get('/:caseNumber/decisions', requireAuth, asyncHandler(decisionController.getDecision));

export {
  router as default,
  service,
  model,
  evidenceService,
  evidenceModel,
  decisionService,
  decisionModel
};
