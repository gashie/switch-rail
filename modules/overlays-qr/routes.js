import { Router } from 'express';
import { asyncHandler, validateBody } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import {
  staticBodySchema,
  dynamicBodySchema,
  decodeBodySchema,
  payBodySchema
} from './schema.js';
import { createQrModel } from './model.js';
import { createQrService } from './service.js';
import { createQrController } from './controller.js';

const model = createQrModel();
const service = createQrService({ db, model });
const controller = createQrController({ service });

const router = Router();

router.post('/static', requireAuth, validateBody(staticBodySchema), asyncHandler(controller.createStatic));
router.post('/dynamic', requireAuth, validateBody(dynamicBodySchema), asyncHandler(controller.createDynamic));
router.post('/decode', requireAuth, validateBody(decodeBodySchema), asyncHandler(controller.decode));
router.post('/pay', requireAuth, validateBody(payBodySchema), asyncHandler(controller.pay));
router.post('/:id/revoke', requireAuth, asyncHandler(controller.revoke));
router.get('/:id', requireAuth, asyncHandler(controller.getById));

export { router as default, service, model };
