import { Router } from 'express';
import { asyncHandler, validateBody } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { quoteBodySchema, registerMakerBodySchema } from './schema.js';
import { createFxModel } from './model.js';
import { createQuoteService } from './quote-service.js';
import { createMakerFakeClient } from './maker-fake.js';
import { registerMakerFactory } from './maker-client.js';
import { createFxController } from './controller.js';

const model = createFxModel();
const service = createQuoteService({ db, model });
const controller = createFxController({ service });

// In production this factory is swapped at boot to call the real maker
// HTTP endpoints. For dev/test the fake adapter returns deterministic test
// rates that match the cross-border simulator's TEST_RATES.
registerMakerFactory(({ maker }) => createMakerFakeClient({ makerCode: maker.maker_code }));

const router = Router();

router.post('/quote', requireAuth, validateBody(quoteBodySchema), asyncHandler(controller.quote));
router.post('/quotes/:id/lock', requireAuth, asyncHandler(controller.lock));
router.post('/expire-past-due', requireAuth, asyncHandler(controller.expirePastDue));
router.get('/quotes/:id', requireAuth, asyncHandler(controller.getById));

// Maker registry (admin).
router.post('/makers', requireAuth, validateBody(registerMakerBodySchema), asyncHandler(controller.registerMaker));
router.get('/makers', requireAuth, asyncHandler(controller.listMakers));

export { router as default, service, model };
