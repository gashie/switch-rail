import Joi from 'joi';

const participantCodeRule = Joi.string().pattern(/^[A-Z0-9_]{3,32}$/);
const amountMinor = Joi.string().pattern(/^\d+$/);
const mccRule = Joi.string().pattern(/^\d{4}$/);

export const staticBodySchema = Joi.object({
  merchantParticipant: participantCodeRule.required(),
  merchantAccountNumber: Joi.string().min(1).max(64).required(),
  mcc: mccRule.required(),
  currency: Joi.string().length(3).uppercase().default('GHS'),
  merchantName: Joi.string().min(1).max(25).required(),
  merchantCity: Joi.string().min(1).max(15).optional()
});

export const dynamicBodySchema = Joi.object({
  merchantParticipant: participantCodeRule.required(),
  merchantAccountNumber: Joi.string().min(1).max(64).required(),
  mcc: mccRule.required(),
  amountMinor: amountMinor.required(),
  currency: Joi.string().length(3).uppercase().default('GHS'),
  merchantName: Joi.string().min(1).max(25).required(),
  merchantCity: Joi.string().min(1).max(15).optional(),
  reference: Joi.string().min(1).max(60).optional(),
  expiresInSeconds: Joi.number().integer().min(60).max(86400).default(3600)
});

export const decodeBodySchema = Joi.object({
  encodedPayload: Joi.string().min(8).max(2000).required()
});

export const payBodySchema = Joi.object({
  encodedPayload: Joi.string().min(8).max(2000).required(),
  payerParticipant: participantCodeRule.required(),
  payerAccountNumber: Joi.string().min(1).max(64).required(),
  payerName: Joi.string().min(1).max(140).required(),
  // For static QRs, payer must supply the amount themselves.
  amountMinorOverride: amountMinor.optional()
});
