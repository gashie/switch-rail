import { Router } from 'express';
import Joi from 'joi';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { envelopeSchema } from './schema.js';
import { createEnvelopeModel } from './model.js';
import { createEnvelopeService } from './service.js';
import { createEnvelopeController } from './controller.js';

const model = createEnvelopeModel();
const service = createEnvelopeService({ db, model });
const controller = createEnvelopeController({ service });

const listQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(500).default(50),
  offset: Joi.number().integer().min(0).default(0)
});

const router = Router();

router.post('/', requireAuth, validateBody(envelopeSchema), asyncHandler(controller.ingest));
router.get('/', requireAuth, validateQuery(listQuerySchema), asyncHandler(controller.list));
router.get('/:envelopeId', requireAuth, asyncHandler(controller.getById));

export { router as default, service };
