import { Router } from 'express';
import { asyncHandler } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { createCreditLegService } from './service.js';
import { createCreditLegController } from './controller.js';

const service = createCreditLegService({ db });
const controller = createCreditLegController({ service });

const router = Router();

router.post('/run/:transactionId', requireAuth, asyncHandler(controller.runById));

export { router as default, service };
