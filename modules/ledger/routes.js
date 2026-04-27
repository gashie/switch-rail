import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import {
  postJournalBodySchema,
  ensureAccountBodySchema,
  listAccountsQuerySchema
} from './schema.js';
import { createLedgerModel } from './model.js';
import { createLedgerService } from './service.js';
import { createLedgerController } from './controller.js';

const model = createLedgerModel();
const service = createLedgerService({ db, model });
const controller = createLedgerController({ service });

const router = Router();

router.get('/accounts', requireAuth, validateQuery(listAccountsQuerySchema), asyncHandler(controller.listAccounts));
router.post('/accounts', requireAuth, validateBody(ensureAccountBodySchema), asyncHandler(controller.ensureAccount));
router.get('/accounts/:code/balance', requireAuth, asyncHandler(controller.balanceFor));
router.get('/journals/:id', requireAuth, asyncHandler(controller.getJournal));
router.post('/journals', requireAuth, validateBody(postJournalBodySchema), asyncHandler(controller.postJournal));
router.get('/verify/:date', requireAuth, asyncHandler(controller.verifyDay));

export { router as default, service, model };
