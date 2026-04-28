import Joi from 'joi';

const currency = Joi.string().length(3).uppercase();
const amountMinor = Joi.string().pattern(/^\d+$/);

export const quoteBodySchema = Joi.object({
  payCurrency: currency.required(),
  receiveCurrency: currency.required(),
  payAmount: amountMinor.required()
});

export const registerMakerBodySchema = Joi.object({
  makerCode: Joi.string().pattern(/^[A-Z0-9_]{3,32}$/).required(),
  makerName: Joi.string().min(1).max(140).required(),
  supportedPairs: Joi.array().items(Joi.string().pattern(/^[A-Z]{3}\/[A-Z]{3}$/)).min(1).required(),
  endpoints: Joi.object().unknown(true).required(),
  priority: Joi.number().integer().min(0).max(1000).default(100),
  metadata: Joi.object().unknown(true).default({})
});

export const idParamSchema = Joi.object({
  id: Joi.string().pattern(/^[0-9a-f-]{36}$/i).required()
});
