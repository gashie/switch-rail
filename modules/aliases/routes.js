import { Router } from 'express';
import Joi from 'joi';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { registerSchema, resolveQuerySchema } from './schema.js';
import { createAliasesModel } from './model.js';
import { createAliasesService } from './service.js';
import { createAliasesController } from './controller.js';
import { buildVerificationRouter } from './verification-routes.js';
import { createPortabilityService } from './portability-service.js';
import { createPortabilityController } from './portability-controller.js';

const model = createAliasesModel();
const service = createAliasesService({ db, model });
const controller = createAliasesController({ service });
const { router: verifyRouter, service: verificationService } = buildVerificationRouter({
  aliasesService: service
});
const portabilityService = createPortabilityService({ db, aliasesService: service });
const portabilityController = createPortabilityController({ service: portabilityService });

const portInitiateBody = Joi.object({
  toParticipant: Joi.string().pattern(/^[A-Z0-9_]{3,32}$/).required(),
  toAccountId: Joi.string().pattern(/^[0-9a-f-]{36}$/i).required()
});

const portConsentBody = Joi.object({
  code: Joi.string().pattern(/^\d{6}$/).required()
});

const router = Router();

router.post('/', requireAuth, validateBody(registerSchema), asyncHandler(controller.register));
router.get('/resolve', requireAuth, validateQuery(resolveQuerySchema), asyncHandler(controller.resolve));
router.get('/by-account/:accountId', requireAuth, asyncHandler(controller.listByAccount));
router.post('/:id/revoke', requireAuth, asyncHandler(controller.revoke));
router.use('/verify', verifyRouter);
router.post('/:id/port', requireAuth, validateBody(portInitiateBody), asyncHandler(portabilityController.initiate));
router.post(
  '/portability/:reqId/consent',
  requireAuth,
  validateBody(portConsentBody),
  asyncHandler(portabilityController.consent)
);
router.get('/portability/:reqId', requireAuth, asyncHandler(portabilityController.getRequest));

export { router as default, service, verificationService, portabilityService, model };
