import Joi from 'joi';
import { RAIL_TYPES, SETTLEMENT_MODELS } from './codes.js';

const railCode = Joi.string().pattern(/^[A-Z0-9_]{3,32}$/);
const currency = Joi.string().length(3).uppercase();
const country = Joi.string().length(2).uppercase();

export const registerBodySchema = Joi.object({
  railCode: railCode.required(),
  railName: Joi.string().min(1).max(140).required(),
  railType: Joi.string().valid(...RAIL_TYPES).required(),
  participantCode: Joi.string().pattern(/^[A-Z0-9_]{3,32}$/).required(),
  supportedCurrencies: Joi.array().items(currency).min(1).required(),
  supportedCountries: Joi.array().items(country).min(1).required(),
  settlementModel: Joi.string().valid(...SETTLEMENT_MODELS).required(),
  cutoverTimeUtc: Joi.string().pattern(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  endpoints: Joi.object({
    quote: Joi.string().uri().required(),
    instruct: Joi.string().uri().required(),
    status: Joi.string().uri().required(),
    freeze: Joi.string().uri().optional(),
    reverse: Joi.string().uri().optional()
  }).required(),
  metadata: Joi.object().unknown(true).default({})
});

export const findQuerySchema = Joi.object({
  country: country.required(),
  currency: currency.required()
});

export const listQuerySchema = Joi.object({
  active: Joi.boolean().optional(),
  railType: Joi.string().valid(...RAIL_TYPES).optional(),
  limit: Joi.number().integer().min(1).max(500).default(100)
});

// Simulator request schemas
export const simulatorQuoteBodySchema = Joi.object({
  payCurrency: currency.required(),
  receiveCurrency: currency.required(),
  payAmount: Joi.string().pattern(/^\d+$/).required()
});

export const simulatorInstructBodySchema = Joi.object({
  quoteId: Joi.string().required(),
  originator: Joi.object().unknown(true).required(),
  beneficiary: Joi.object({
    accountId: Joi.string().required()
  }).unknown(true).required(),
  travelRule: Joi.object().unknown(true).required(),
  payAmount: Joi.string().pattern(/^\d+$/).optional(),
  receiveAmount: Joi.string().pattern(/^\d+$/).optional()
});

export const simulatorStatusBodySchema = Joi.object({
  foreignTxId: Joi.string().required()
});

export const simulatorFreezeBodySchema = Joi.object({
  foreignTxId: Joi.string().required(),
  reason: Joi.string().required()
});

export const simulatorReverseBodySchema = Joi.object({
  foreignTxId: Joi.string().required(),
  reason: Joi.string().required()
});
