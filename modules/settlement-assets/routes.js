import { Router } from 'express';
import { asyncHandler, validateBody } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { settleBodySchema } from './schema.js';
import { registerAssetClient } from './asset-client.js';
import { createLocalCurrencyClient } from './local-currency-client.js';
import { createCbdcFakeClient } from './cbdc-fake.js';
import { createStablecoinFakeClient } from './stablecoin-fake.js';
import { createSettlementAssetsService } from './service.js';
import { createSettlementAssetsController } from './controller.js';

// Register the three default adapters at module load. Production swaps
// CBDC and stablecoin for real clients via env config; LOCAL_CURRENCY_NET
// is always the canonical default.
registerAssetClient('LOCAL_CURRENCY_NET', createLocalCurrencyClient());
registerAssetClient('CBDC', createCbdcFakeClient());
registerAssetClient('STABLECOIN', createStablecoinFakeClient());

const service = createSettlementAssetsService({ db });
const controller = createSettlementAssetsController({ service });

const router = Router();

router.post('/settle', requireAuth, validateBody(settleBodySchema), asyncHandler(controller.settle));
router.get('/adapters', requireAuth, asyncHandler(controller.adapters));

export { router as default, service };
