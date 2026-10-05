import Joi from 'joi';

export const RUN_TYPES = Object.freeze(['CONTINUOUS', 'EOD', 'EXCEPTION']);
export const BREAK_TYPES = Object.freeze([
  'MISSING_AT_PARTICIPANT',
  'MISSING_AT_RAIL',
  'AMOUNT_MISMATCH',
  'STATUS_MISMATCH'
]);
export const RESOLUTIONS = Object.freeze([
  'pending',
  'auto_resolved',
  'operator_resolved',
  'escalated'
]);

const currency = Joi.string().length(3).uppercase();
const participantCode = Joi.string().pattern(/^[A-Z0-9_]{3,32}$/);
const dateString = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/);
const uuidRule = Joi.string().pattern(/^[0-9a-f-]{36}$/i);

export const runBodySchema = Joi.object({
  participantCode: participantCode.required(),
  currency: currency.required(),
  operatingDate: dateString.required(),
  runType: Joi.string().valid(...RUN_TYPES).default('CONTINUOUS')
});

export const idParamSchema = Joi.object({
  id: uuidRule.required()
});

export const listRunsQuerySchema = Joi.object({
  participantCode: participantCode.optional(),
  currency: currency.optional(),
  operatingDate: dateString.optional(),
  runType: Joi.string().valid(...RUN_TYPES).optional(),
  limit: Joi.number().integer().min(1).max(500).default(100)
});

export const listBreaksQuerySchema = Joi.object({
  resolution: Joi.string().valid(...RESOLUTIONS).optional(),
  participantCode: participantCode.optional(),
  limit: Joi.number().integer().min(1).max(500).default(100)
});

export const resolveBreakBodySchema = Joi.object({
  resolution: Joi.string().valid('auto_resolved', 'operator_resolved', 'escalated').required(),
  notes: Joi.string().min(1).max(2000).required()
});
