import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { createCryptoKeysModel } from './model.js';
import { createCryptoKeysService } from './service.js';
import { createCryptoKeysController } from './controller.js';
import { ownerSchema, listQuerySchema } from './schema.js';

const model = createCryptoKeysModel();
const service = createCryptoKeysService({ db, model });
const controller = createCryptoKeysController({ service });

const router = Router();

router.get('/rail/active', requireAuth, asyncHandler(controller.listRailActive));
router.get('/', requireAuth, validateQuery(listQuerySchema), asyncHandler(controller.list));
router.post('/', requireAuth, validateBody(ownerSchema), asyncHandler(controller.generate));
router.post('/rotate', requireAuth, validateBody(ownerSchema), asyncHandler(controller.rotate));
router.post('/:kid/revoke', requireAuth, asyncHandler(controller.revoke));

export { router as default, service };
