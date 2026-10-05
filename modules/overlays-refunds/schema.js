import Joi from 'joi';
import { REASON_CODES } from './codes.js';

const uuidRule = Joi.string().pattern(/^[0-9a-f-]{36}$/i);
const participantCodeRule = Joi.string().pattern(/^[A-Z0-9_]{3,32}$/);
const amountMinor = Joi.string().pattern(/^\d+$/);

export const initiateBodySchema = Joi.object({
  originalTransactionId: uuidRule.required(),
  initiatedByParticipant: participantCodeRule.required(),
  amountMinor: amountMinor.required(),
  reasonCode: Joi.string().valid(...REASON_CODES).required(),
  reasonMessage: Joi.string().min(1).max(500).optional()
});

export const listQuerySchema = Joi.object({
  originalTransactionId: uuidRule.optional(),
  state: Joi.string().valid('INITIATED', 'PROCESSING', 'COMPLETED', 'FAILED').optional(),
  limit: Joi.number().integer().min(1).max(500).default(100)
});
