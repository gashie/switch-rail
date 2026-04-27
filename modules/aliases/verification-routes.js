import { Router } from 'express';
import Joi from 'joi';
import { asyncHandler, validateBody } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { createVerificationService } from './verification-service.js';
import { createVerificationController } from './verification-controller.js';

const aliasIdBody = Joi.object({
  aliasId: Joi.string().pattern(/^[0-9a-f-]{36}$/i).required()
});

const otpConsumeBody = Joi.object({
  aliasId: Joi.string().pattern(/^[0-9a-f-]{36}$/i).required(),
  code: Joi.string().pattern(/^\d{6}$/).required()
});

const emailConsumeBody = Joi.object({
  aliasId: Joi.string().pattern(/^[0-9a-f-]{36}$/i).required(),
  token: Joi.string().min(8).max(256).required()
});

export const buildVerificationRouter = ({ aliasesService }) => {
  const service = createVerificationService({ db, aliasesService });
  const controller = createVerificationController({ service });
  const router = Router();
  router.post('/otp/start', requireAuth, validateBody(aliasIdBody), asyncHandler(controller.startOtp));
  router.post('/otp', requireAuth, validateBody(otpConsumeBody), asyncHandler(controller.consumeOtp));
  router.post('/email/start', requireAuth, validateBody(aliasIdBody), asyncHandler(controller.startEmail));
  router.post('/email', requireAuth, validateBody(emailConsumeBody), asyncHandler(controller.consumeEmail));
  router.post('/ghanacard', requireAuth, validateBody(aliasIdBody), asyncHandler(controller.verifyGhanacard));
  return { router, service };
};
