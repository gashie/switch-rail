import express, { Router } from 'express';
import { asyncHandler, validateBody } from '../../core/http.js';
import { requireAuth } from '../auth/index.js';
import { envelopeService, envelopeSchema } from '../envelope/index.js';
import { createSwiftService } from './service.js';
import { createSwiftController } from './controller.js';

const service = createSwiftService({ envelope: envelopeService });
const controller = createSwiftController({ service });

const textBody = express.text({ type: ['text/plain', 'application/x-swift-mt'], limit: '256kb' });

const router = Router();

router.post('/inbound/:kind', requireAuth, textBody, asyncHandler(controller.inbound));
router.post('/outbound/:kind', requireAuth, validateBody(envelopeSchema), asyncHandler(controller.outbound));

export { router as default, service };
