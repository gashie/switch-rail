import { Router } from 'express';
import { asyncHandler, validateBody } from '../../core/http.js';
import * as db from '../../core/db.js';
import { directoryService } from '../directory/index.js';
import { requireAuth } from '../auth/index.js';
import { proposeChangeBodySchema } from './schema.js';
import { createRulesModel } from './rules-model.js';
import { createRulesService } from './rules-service.js';
import { createSignalsModel } from './signals-model.js';
import { createSignalsService } from './signals-service.js';
import { createBaselineModel } from './baseline-model.js';
import { createBaselineService } from './baseline-service.js';
import { createBaselineWorker } from './baseline-worker.js';
import { createRuleContextBuilder } from './rule-context-builder.js';
import { createFraudController } from './controller.js';

const rulesModel = createRulesModel();
const rulesService = createRulesService({ db, model: rulesModel });
const signalsModel = createSignalsModel();
const signalsService = createSignalsService({ db, model: signalsModel });
const baselineModel = createBaselineModel();
const baselineService = createBaselineService({ db, model: baselineModel });
const baselineWorker = createBaselineWorker({ baselineService });
const ruleContextBuilder = createRuleContextBuilder({
  db,
  directoryService,
  baselineModel
});
const controller = createFraudController({ rulesService, signalsService });

const router = Router();

router.get('/packs', requireAuth, asyncHandler(controller.listPacks));
router.get('/packs/:code', requireAuth, asyncHandler(controller.getPackByCode));
router.get('/rules/:id', requireAuth, asyncHandler(controller.getRule));
router.post(
  '/rules/:id/propose',
  requireAuth,
  validateBody(proposeChangeBodySchema),
  asyncHandler(controller.proposeRuleChange)
);
router.post('/rules/:id/approve', requireAuth, asyncHandler(controller.approveRuleChange));
router.get('/signals/by-transaction/:txId', requireAuth, asyncHandler(controller.signalsByTransaction));

export {
  router as default,
  rulesService,
  rulesModel,
  signalsService,
  signalsModel,
  baselineService,
  baselineModel,
  baselineWorker,
  ruleContextBuilder
};
