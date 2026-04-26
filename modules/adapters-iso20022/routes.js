import express, { Router } from 'express';
import { asyncHandler, validateBody } from '../../core/http.js';
import { requireAuth } from '../auth/index.js';
import { envelopeService, envelopeSchema } from '../envelope/index.js';
import { createIso20022Service } from './service.js';
import { createIso20022Controller } from './controller.js';

const service = createIso20022Service({ envelope: envelopeService });
const controller = createIso20022Controller({ service });

const xmlBody = express.text({ type: ['application/xml', 'text/xml'], limit: '5mb' });

const router = Router();

router.post('/inbound/pacs008', requireAuth, xmlBody, asyncHandler(controller.inboundPacs008));
router.post('/inbound/pacs002', requireAuth, xmlBody, asyncHandler(controller.inboundPacs002));
router.post('/inbound/pacs004', requireAuth, xmlBody, asyncHandler(controller.inboundPacs004));
router.post('/inbound/pacs007', requireAuth, xmlBody, asyncHandler(controller.inboundPacs007));
router.post('/inbound/camt056', requireAuth, xmlBody, asyncHandler(controller.inboundCamt056));

router.post(
  '/outbound/:type',
  requireAuth,
  validateBody(envelopeSchema),
  asyncHandler(controller.outbound)
);

export { router as default, service };
