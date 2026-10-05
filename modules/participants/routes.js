import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { createSchema, updateSchema, listQuerySchema } from './schema.js';
import { createParticipantsModel } from './model.js';
import { createParticipantsService } from './service.js';
import { createParticipantsController } from './controller.js';

const model = createParticipantsModel();
const service = createParticipantsService({ db, model });
const controller = createParticipantsController({ service });

const router = Router();

router.post('/', requireAuth, validateBody(createSchema), asyncHandler(controller.create));
router.get('/', requireAuth, validateQuery(listQuerySchema), asyncHandler(controller.list));
router.get('/:code', requireAuth, asyncHandler(controller.getByCode));
router.patch('/:code', requireAuth, validateBody(updateSchema), asyncHandler(controller.update));
router.get('/:code/keys', requireAuth, asyncHandler(controller.listKeys));

export { router as default, service };
