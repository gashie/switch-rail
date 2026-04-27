import Joi from 'joi';

export const RULE_TYPES = Object.freeze(['BIN', 'MSISDN_PREFIX', 'BIC', 'PARTICIPANT_CODE']);

const participantCodeRule = Joi.string().pattern(/^[A-Z0-9_]{3,32}$/);

export const addRuleSchema = Joi.object({
  ruleType: Joi.string().valid(...RULE_TYPES).required(),
  pattern: Joi.string().min(1).max(64).required(),
  participantCode: participantCodeRule.required(),
  priority: Joi.number().integer().min(0).max(10000).default(100),
  notes: Joi.string().allow('').max(2000).optional()
});

export const listQuerySchema = Joi.object({
  ruleType: Joi.string().valid(...RULE_TYPES).optional(),
  participantCode: participantCodeRule.optional(),
  active: Joi.boolean().optional()
});

export const resolveBodySchema = Joi.object({
  accountNumber: Joi.string().min(1).max(64).optional(),
  msisdn: Joi.string().min(1).max(32).optional(),
  bic: Joi.string().pattern(/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/).optional(),
  participantCode: participantCodeRule.optional()
}).or('accountNumber', 'msisdn', 'bic', 'participantCode');

export const idParamSchema = Joi.object({
  id: Joi.string().pattern(/^[0-9a-f-]{36}$/i).required()
});
