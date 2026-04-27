import Joi from 'joi';
import { SOURCE_FORMATS } from './codes.js';

const participantCodeRule = Joi.string().pattern(/^[A-Z0-9_]{3,32}$/);

export const uploadFieldsSchema = Joi.object({
  originatorParticipant: participantCodeRule.required(),
  sourceFormat: Joi.string().valid(...SOURCE_FORMATS).required()
});

export const listQuerySchema = Joi.object({
  originatorParticipant: participantCodeRule.optional(),
  state: Joi.string().valid('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL').optional(),
  limit: Joi.number().integer().min(1).max(500).default(100)
});
