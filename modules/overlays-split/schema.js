import Joi from 'joi';
import { MIN_LEGS, MAX_LEGS } from './codes.js';

const participantCodeRule = Joi.string().pattern(/^[A-Z0-9_]{3,32}$/);
const amountMinor = Joi.string().pattern(/^\d+$/);

const legSchema = Joi.object({
  beneficiaryParticipant: participantCodeRule.required(),
  beneficiaryAccountNumber: Joi.string().min(1).max(64).required(),
  beneficiaryName: Joi.string().min(1).max(140).required(),
  amountMinor: amountMinor.required(),
  description: Joi.string().min(1).max(280).optional()
});

export const createBodySchema = Joi.object({
  payerParticipant: participantCodeRule.required(),
  payerAccountNumber: Joi.string().min(1).max(64).required(),
  payerName: Joi.string().min(1).max(140).required(),
  totalAmountMinor: amountMinor.required(),
  currency: Joi.string().length(3).uppercase().required(),
  reference: Joi.string().min(1).max(140).optional(),
  legs: Joi.array().items(legSchema).min(MIN_LEGS).max(MAX_LEGS).required()
});

export const listQuerySchema = Joi.object({
  payerParticipant: participantCodeRule.optional(),
  state: Joi.string().valid('INITIATED', 'COMPLETED', 'FAILED').optional(),
  limit: Joi.number().integer().min(1).max(500).default(100)
});
