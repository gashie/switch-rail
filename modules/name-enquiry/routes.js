import { Router } from 'express';
import { asyncHandler, validateBody } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { resolveBodySchema } from './schema.js';
import { createNameEnquiryService } from './service.js';
import { createNameEnquiryController } from './controller.js';

const service = createNameEnquiryService({ db });
const controller = createNameEnquiryController({ service });

const router = Router();

router.post('/resolve', requireAuth, validateBody(resolveBodySchema), asyncHandler(controller.resolve));

export { router as default, service };
