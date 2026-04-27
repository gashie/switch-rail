import Joi from 'joi';

export const ALERT_TYPES = Object.freeze(['MULE_RING', 'STRUCTURING', 'COORDINATED_BURST']);
export const ALERT_STATUSES = Object.freeze(['open', 'investigating', 'confirmed', 'dismissed']);

const uuidRule = Joi.string().pattern(/^[0-9a-f-]{36}$/i);

export const accountKeyParamSchema = Joi.object({
  accountKey: Joi.string().min(3).max(140).required()
});

export const idParamSchema = Joi.object({
  id: uuidRule.required()
});

export const listAlertsQuerySchema = Joi.object({
  alertType: Joi.string().valid(...ALERT_TYPES).optional(),
  status: Joi.string().valid(...ALERT_STATUSES).optional(),
  limit: Joi.number().integer().min(1).max(500).default(100)
});

export const resolveAlertBodySchema = Joi.object({
  status: Joi.string().valid('confirmed', 'dismissed', 'investigating').required(),
  notes: Joi.string().min(1).max(2000).optional()
});

export const scanBodySchema = Joi.object({
  windowHours: Joi.number().integer().min(1).max(168).default(24)
});
