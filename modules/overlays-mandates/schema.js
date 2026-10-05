import Joi from 'joi';
import { FREQUENCIES, REVOCATION_ACTORS } from './codes.js';

const participantCodeRule = Joi.string().pattern(/^[A-Z0-9_]{3,32}$/);
const amountMinor = Joi.string().pattern(/^\d+$/);

export const createBodySchema = Joi.object({
  payerParticipant: participantCodeRule.required(),
  payerAccountNumber: Joi.string().min(1).max(64).required(),
  payeeParticipant: participantCodeRule.required(),
  payeeAccountNumber: Joi.string().min(1).max(64).required(),
  perDebitCapMinor: amountMinor.required(),
  dailyCapMinor: amountMinor.optional(),
  monthlyCapMinor: amountMinor.optional(),
  totalCapMinor: amountMinor.optional(),
  currency: Joi.string().length(3).uppercase().required(),
  frequency: Joi.string().valid(...FREQUENCIES).required(),
  reference: Joi.string().min(1).max(140).optional(),
  description: Joi.string().min(1).max(280).optional(),
  effectiveFrom: Joi.string().isoDate().optional(),
  effectiveTo: Joi.string().isoDate().optional()
});

export const presentDebitBodySchema = Joi.object({
  presentedAmountMinor: amountMinor.required(),
  reference: Joi.string().min(1).max(140).optional()
});

export const revokeBodySchema = Joi.object({
  revokedBy: Joi.string().valid(...REVOCATION_ACTORS).required(),
  reason: Joi.string().min(1).max(500).optional()
});

export const pauseBodySchema = Joi.object({
  reason: Joi.string().min(1).max(500).optional()
});

export const listQuerySchema = Joi.object({
  payerParticipant: participantCodeRule.optional(),
  payeeParticipant: participantCodeRule.optional(),
  state: Joi.string().valid('ACTIVE', 'PAUSED', 'REVOKED', 'EXHAUSTED').optional(),
  limit: Joi.number().integer().min(1).max(500).default(100)
});
