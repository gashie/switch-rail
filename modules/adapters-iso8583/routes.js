import express, { Router } from 'express';
import { asyncHandler, validateBody } from '../../core/http.js';
import { requireAuth } from '../auth/index.js';
import { envelopeService, envelopeSchema } from '../envelope/index.js';
import { createIso8583Service } from './service.js';
import { createIso8583Controller } from './controller.js';

const service = createIso8583Service({ envelope: envelopeService });
const controller = createIso8583Controller({ service });

const binaryBody = express.raw({ type: ['application/octet-stream', 'application/iso8583'], limit: '1mb' });

const router = Router();

router.post('/inbound', requireAuth, binaryBody, asyncHandler(controller.inbound));
router.post('/outbound', requireAuth, validateBody(envelopeSchema), asyncHandler(controller.outbound));

export { router as default, service };
