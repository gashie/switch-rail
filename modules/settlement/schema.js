import Joi from 'joi';

const currency = Joi.string().length(3).uppercase();
const participantCode = Joi.string().pattern(/^[A-Z0-9_]{3,32}$/);

export const listQuerySchema = Joi.object({
  currency: currency.optional(),
  participantCode: participantCode.optional()
});

export const participantParamSchema = Joi.object({
  participantCode: participantCode.required()
});

export const recomputeBodySchema = Joi.object({
  currency: currency.optional(),
  participantCode: participantCode.optional()
});
