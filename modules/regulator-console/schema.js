import Joi from 'joi';

export const dailyDigestSchema = Joi.object({
  day: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required()
}).unknown(false);

export const exportLogSchema = Joi.object({
  reason: Joi.string().min(1).max(512).required(),
  resourceType: Joi.string().min(1).max(64).required(),
  filters: Joi.object().default({})
}).unknown(false);
