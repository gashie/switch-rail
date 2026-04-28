import Joi from 'joi';

// USSD callback shape from the telco aggregator. Fields follow the common
// MTN/Vodafone/Airtel-Tigo Ghana shape: sessionId, msisdn, serviceCode,
// text (the cumulative input). The gateway converts that into a
// step+output tree.
export const ussdCallbackSchema = Joi.object({
  sessionId: Joi.string().min(1).max(128).required(),
  msisdn: Joi.string().pattern(/^\+?\d{6,15}$/).required(),
  serviceCode: Joi.string().min(1).max(32).required(),
  text: Joi.string().allow('').default('')
}).unknown(true);

export const listSessionsSchema = Joi.object({
  msisdn: Joi.string(),
  limit: Joi.number().integer().min(1).max(500).default(100)
}).unknown(false);
