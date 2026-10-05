import Joi from 'joi';

const participantCodeRule = Joi.string().pattern(/^[A-Z0-9_]{3,32}$/);
const amountMinor = Joi.string().pattern(/^\d+$/);

export const initiateBodySchema = Joi.object({
  customerParticipant: participantCodeRule.required(),
  customerAccountNumber: Joi.string().min(1).max(64).required(),
  agentParticipant: participantCodeRule.required(),
  agentFloatAccountNumber: Joi.string().min(1).max(64).required(),
  amountMinor: amountMinor.required(),
  currency: Joi.string().length(3).uppercase().required(),
  expiresInMinutes: Joi.number().integer().min(1).max(120).default(15)
});

export const completeBodySchema = Joi.object({
  otp: Joi.string().pattern(/^\d{6}$/).required(),
  customerName: Joi.string().min(1).max(140).required()
});

export const cancelBodySchema = Joi.object({
  cancelledBy: Joi.string().valid('CUSTOMER', 'AGENT', 'OPERATOR').required(),
  reason: Joi.string().min(1).max(500).optional()
});

export const listQuerySchema = Joi.object({
  customerParticipant: participantCodeRule.optional(),
  agentParticipant: participantCodeRule.optional(),
  state: Joi.string().valid('INITIATED', 'AUTHORIZED', 'COMPLETED', 'CANCELLED', 'EXPIRED').optional(),
  limit: Joi.number().integer().min(1).max(500).default(100)
});
