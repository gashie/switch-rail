import Joi from 'joi';

export const SUBJECT_TYPES = Object.freeze(['ACCOUNT', 'ALIAS', 'BENEFICIARY_NAME']);
export const FLAG_TYPES = Object.freeze([
  'CONFIRMED_FRAUD',
  'SUSPICIOUS',
  'STOLEN_DEVICE',
  'COMPROMISED_ALIAS'
]);

const uuidRule = Joi.string().pattern(/^[0-9a-f-]{36}$/i);
const participantCode = Joi.string().pattern(/^[A-Z0-9_]{3,32}$/);

export const flagBodySchema = Joi.object({
  subjectType: Joi.string().valid(...SUBJECT_TYPES).required(),
  subjectKey: Joi.string().min(3).max(200).required(),
  flagType: Joi.string().valid(...FLAG_TYPES).required(),
  flaggedBy: participantCode.required(),
  evidence: Joi.object().unknown(true).optional(),
  severity: Joi.number().integer().min(1).max(100).default(70),
  expiresInDays: Joi.number().integer().min(1).max(3650).optional()
});

export const withdrawBodySchema = Joi.object({
  withdrawnBy: participantCode.required()
});

export const listActiveQuerySchema = Joi.object({
  subjectType: Joi.string().valid(...SUBJECT_TYPES).optional(),
  subjectKey: Joi.string().min(3).max(200).optional(),
  limit: Joi.number().integer().min(1).max(500).default(100)
});

export const idParamSchema = Joi.object({
  id: uuidRule.required()
});
