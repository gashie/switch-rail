import Joi from 'joi';
import { RELEASE_CONDITIONS } from './codes.js';

const uuidRule = Joi.string().pattern(/^[0-9a-f-]{36}$/i);
const participantCodeRule = Joi.string().pattern(/^[A-Z0-9_]{3,32}$/);
const amountMinor = Joi.string().pattern(/^\d+$/);

export const createBodySchema = Joi.object({
  payerParticipant: participantCodeRule.required(),
  payerAccountNumber: Joi.string().min(1).max(64).required(),
  payerName: Joi.string().min(1).max(140).required(),
  payeeParticipant: participantCodeRule.required(),
  payeeAccountNumber: Joi.string().min(1).max(64).required(),
  amountMinor: amountMinor.required(),
  currency: Joi.string().length(3).uppercase().required(),
  releaseCondition: Joi.string().valid(...RELEASE_CONDITIONS).required(),
  releaseAt: Joi.string().isoDate().optional(),
  arbiterUserId: uuidRule.optional(),
  reason: Joi.string().min(1).max(500).optional()
});

export const signBodySchema = Joi.object({
  signedBy: Joi.string().valid('PAYER', 'PAYEE').required()
});

export const arbiterReleaseBodySchema = Joi.object({
  arbiterUserId: uuidRule.required(),
  reason: Joi.string().min(1).max(500).optional()
});

export const refundBodySchema = Joi.object({
  reason: Joi.string().min(1).max(500).required()
});

export const listQuerySchema = Joi.object({
  payerParticipant: participantCodeRule.optional(),
  payeeParticipant: participantCodeRule.optional(),
  state: Joi.string().valid('INITIATED', 'HELD', 'RELEASED', 'REFUNDED', 'CANCELLED').optional(),
  limit: Joi.number().integer().min(1).max(500).default(100)
});
