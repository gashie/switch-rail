import Joi from 'joi';

export const STATES = Object.freeze(['invoked', 'frozen', 'completed', 'rejected', 'expired']);

const uuidRule = Joi.string().pattern(/^[0-9a-f-]{36}$/i);

export const invokeBodySchema = Joi.object({
  originalTransactionId: uuidRule.required(),
  evidence: Joi.object().unknown(true).required(),
  reasonCode: Joi.string().valid('FRAD', 'CUST', 'TECH', 'DUPL', 'RGLT').required(),
  reasonMessage: Joi.string().min(1).max(500).optional()
});

export const idParamSchema = Joi.object({
  id: uuidRule.required()
});

export const listQuerySchema = Joi.object({
  state: Joi.string().valid(...STATES).optional(),
  victimParticipant: Joi.string().pattern(/^[A-Z0-9_]{3,32}$/).optional(),
  limit: Joi.number().integer().min(1).max(500).default(100)
});
