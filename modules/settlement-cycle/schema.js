import Joi from 'joi';

export const CYCLE_TYPES = Object.freeze([
  'INTRADAY_NET',
  'END_OF_DAY',
  'RTGS_GROSS',
  'EXCEPTION'
]);

export const CYCLE_STATES = Object.freeze([
  'pending',
  'running',
  'completed',
  'failed'
]);

const currency = Joi.string().length(3).uppercase();

export const createCycleBodySchema = Joi.object({
  cycleType: Joi.string().valid(...CYCLE_TYPES).required(),
  currency: currency.required(),
  operatingDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  reason: Joi.string().min(1).max(500).optional()
});

export const runCycleBodySchema = Joi.object({
  confirmation: Joi.string().min(4).max(128).required()
});

export const idParamSchema = Joi.object({
  id: Joi.string().pattern(/^[0-9a-f-]{36}$/i).required()
});

export const listQuerySchema = Joi.object({
  cycleType: Joi.string().valid(...CYCLE_TYPES).optional(),
  currency: currency.optional(),
  operatingDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  state: Joi.string().valid(...CYCLE_STATES).optional(),
  limit: Joi.number().integer().min(1).max(500).default(100)
});
