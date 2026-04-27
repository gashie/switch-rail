import Joi from 'joi';
import { VERDICTS, RULE_CODES, PACK_CODES } from './codes.js';

const uuidRule = Joi.string().pattern(/^[0-9a-f-]{36}$/i);
const participantCode = Joi.string().pattern(/^[A-Z0-9_]{3,32}$/);

export const proposeChangeBodySchema = Joi.object({
  weight: Joi.number().integer().min(0).max(100).optional(),
  active: Joi.boolean().optional(),
  parameters: Joi.object().unknown(true).optional()
}).min(1);

export const idParamSchema = Joi.object({
  id: uuidRule.required()
});

export const txIdParamSchema = Joi.object({
  txId: uuidRule.required()
});

export const packCodeParamSchema = Joi.object({
  code: Joi.string().valid(...Object.values(PACK_CODES)).required()
});

export const evaluateBodySchema = Joi.object({
  transactionId: uuidRule.required()
});

export { VERDICTS, RULE_CODES, PACK_CODES };
export { participantCode };
