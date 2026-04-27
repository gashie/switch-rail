import { Router } from 'express';
import Joi from 'joi';
import { asyncHandler, validateBody } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { resolveBodySchema, inputUnion } from './schema.js';
import { createNameEnquiryService } from './service.js';
import { createNameEnquiryController } from './controller.js';
import { createCopService } from './cop-service.js';
import { createCopController } from './cop-controller.js';

const service = createNameEnquiryService({ db });
const controller = createNameEnquiryController({ service });
const copService = createCopService({ db, nameEnquiryService: service });
const copController = createCopController({ service: copService });

const copBodySchema = Joi.object({
  input: inputUnion,
  suppliedName: Joi.string().min(1).max(280).required()
}).unknown(false);

const router = Router();

router.post('/resolve', requireAuth, validateBody(resolveBodySchema), asyncHandler(controller.resolve));
router.post('/cop', requireAuth, validateBody(copBodySchema), asyncHandler(copController.cop));

export { router as default, service, copService };
