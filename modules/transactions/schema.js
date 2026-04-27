import Joi from 'joi';
import { envelopeSchema } from '../envelope/index.js';

export const ingestSchema = Joi.object({
  envelope: envelopeSchema.required()
}).unknown(false);

export const idParamSchema = Joi.object({
  id: Joi.string().pattern(/^[0-9a-f-]{36}$/i).required()
});

export const killBodySchema = Joi.object({
  reason: Joi.string().max(500).optional()
});

export const listQuerySchema = Joi.object({
  participantCode: Joi.string().pattern(/^[A-Z0-9_]{3,32}$/).optional(),
  state: Joi.string().max(40).optional(),
  limit: Joi.number().integer().min(1).max(500).default(50),
  offset: Joi.number().integer().min(0).default(0)
});
