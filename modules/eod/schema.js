import Joi from 'joi';

export const DAY_STATES = Object.freeze(['OPEN', 'CLOSING', 'CLOSED']);

const dateString = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/);
const currency = Joi.string().length(3).uppercase();
const participantCode = Joi.string().pattern(/^[A-Z0-9_]{3,32}$/);

export const cutoverBodySchema = Joi.object({
  operatingDate: dateString.required(),
  confirmation: Joi.string().min(4).max(128).required()
});

export const dateParamSchema = Joi.object({
  date: dateString.required()
});

export const statementParamSchema = Joi.object({
  date: dateString.required(),
  participantCode: participantCode.required(),
  currency: currency.required()
});

export const verifyBodySchema = Joi.object({
  payload: Joi.object().required(),
  signature: Joi.string().min(1).required(),
  kid: Joi.string().min(1).required()
});
