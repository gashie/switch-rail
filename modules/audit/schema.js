import Joi from 'joi';

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

export const listQuerySchema = Joi.object({
  from: Joi.string().pattern(dayPattern).optional(),
  to: Joi.string().pattern(dayPattern).optional(),
  actor: Joi.string().max(256).optional(),
  eventType: Joi.string().max(128).optional(),
  resourceType: Joi.string().max(128).optional(),
  resourceId: Joi.string().max(256).optional(),
  limit: Joi.number().integer().min(1).max(1000).default(100),
  offset: Joi.number().integer().min(0).default(0)
});

export const verifyDaySchema = Joi.object({
  day: Joi.string().pattern(dayPattern).required()
});
