import Joi from 'joi';

export const ACCOUNT_TYPES = Object.freeze([
  'BANK_ACCOUNT',
  'WALLET',
  'AGENT_FLOAT',
  'MERCHANT_SETTLEMENT'
]);

export const ACCOUNT_STATUSES = Object.freeze(['active', 'frozen', 'closed']);

const participantCodeRule = Joi.string().pattern(/^[A-Z0-9_]{3,32}$/);

export const registerSchema = Joi.object({
  participantCode: participantCodeRule.required(),
  accountType: Joi.string()
    .valid(...ACCOUNT_TYPES)
    .required(),
  accountNumber: Joi.string().min(1).max(64).required(),
  accountName: Joi.string().min(1).max(140).required(),
  currency: Joi.string().length(3).uppercase().default('GHS'),
  metadata: Joi.object().unknown(true).default({})
});

export const listQuerySchema = Joi.object({
  participantCode: participantCodeRule.optional(),
  accountType: Joi.string()
    .valid(...ACCOUNT_TYPES)
    .optional(),
  status: Joi.string()
    .valid(...ACCOUNT_STATUSES)
    .optional(),
  limit: Joi.number().integer().min(1).max(500).default(50),
  offset: Joi.number().integer().min(0).default(0)
});

export const searchQuerySchema = Joi.object({
  participantCode: participantCodeRule.required(),
  q: Joi.string().min(1).max(140).required(),
  limit: Joi.number().integer().min(1).max(50).default(10)
});
