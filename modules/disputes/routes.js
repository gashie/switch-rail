import { Router } from 'express';
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

const model = createDisputesModel();
const autoValidator = createAutoValidator({ model });
const reserveHolder = createReserveHolder({ model });
const service = createDisputesService({
  db,
  model,
  autoValidator,
  reserveHolder
});
const controller = createDisputesController({ service });

const router = Router();

router.post('/', requireAuth, validateBody(fileBodySchema), asyncHandler(controller.file));
router.get('/', requireAuth, validateQuery(listQuerySchema), asyncHandler(controller.list));
router.get('/transaction/:txId', requireAuth, asyncHandler(controller.listForTransaction));
router.get('/:caseNumber', requireAuth, asyncHandler(controller.getByCaseNumber));
router.get('/:caseNumber/history', requireAuth, asyncHandler(controller.history));
router.post('/:caseNumber/process', requireAuth, asyncHandler(controller.process));
router.post('/:id/kill', requireAuth, validateBody(killBodySchema), asyncHandler(controller.kill));

export { router as default, service, model };
