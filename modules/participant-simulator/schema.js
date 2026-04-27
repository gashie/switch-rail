import Joi from 'joi';

const accountIdRule = Joi.string().min(1).max(64);
const txIdRule = Joi.string().pattern(/^[0-9a-f-]{36}$/i);

export const creditLegBodySchema = Joi.object({
  envelopeId: Joi.string().required(),
  transactionId: txIdRule.required(),
  endToEndId: Joi.string().required(),
  amount: Joi.object({
    value: Joi.string().pattern(/^\d+$/).required(),
    currency: Joi.string().length(3).uppercase().required()
  }).required(),
  originator: Joi.object({
    participantCode: Joi.string().required(),
    accountId: accountIdRule.required(),
    name: Joi.string().required()
  }).unknown(true).required(),
  beneficiary: Joi.object({
    participantCode: Joi.string().required(),
    accountId: accountIdRule.required(),
    name: Joi.string().required()
  }).unknown(true).required(),
  reference: Joi.string().allow('').optional(),
  remittance: Joi.string().allow('').optional(),
  purposeCode: Joi.string().allow('').optional(),
  settlementMethod: Joi.string().allow('').optional()
}).unknown(true);

export const statusCheckBodySchema = Joi.object({
  transactionId: txIdRule.required(),
  endToEndId: Joi.string().required()
}).unknown(true);

export const reversalBodySchema = Joi.object({
  originalTransactionId: txIdRule.required(),
  reversalTransactionId: txIdRule.required(),
  reasonCode: Joi.string().required(),
  amount: Joi.object({
    value: Joi.string().pattern(/^\d+$/).required(),
    currency: Joi.string().length(3).uppercase().required()
  }).required()
}).unknown(true);

export const overrideBodySchema = Joi.object({
  participantCode: Joi.string().pattern(/^[A-Z0-9_]{3,32}$/).required(),
  accountNumber: accountIdRule.required(),
  behavior: Joi.string().required(),
  reasonCode: Joi.string().optional(),
  delayMs: Joi.number().integer().min(0).max(60000).default(50)
});
