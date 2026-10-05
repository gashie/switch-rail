import Joi from 'joi';

const currency = Joi.string().length(3).uppercase();
const participantCode = Joi.string().pattern(/^[A-Z0-9_]{3,32}$/);
const bigintMinor = Joi.alternatives().try(
  Joi.string().pattern(/^-?\d+$/, 'digit-string'),
  Joi.number().integer()
);

export const limitsParamSchema = Joi.object({
  participantCode: participantCode.required(),
  currency: currency.required()
});

export const limitsBodySchema = Joi.object({
  prefundedMinor: bigintMinor.required(),
  floorMinor: bigintMinor.required(),
  ceilingMinor: bigintMinor.required(),
  throttleThresholdPct: Joi.number().integer().min(1).max(100).default(80)
});

export const topupBodySchema = Joi.object({
  participantCode: participantCode.required(),
  currency: currency.required(),
  amountMinor: bigintMinor.required(),
  reason: Joi.string().min(1).max(500).required()
});

export const listLimitsQuerySchema = Joi.object({
  currency: currency.optional()
});

export const listTopupsQuerySchema = Joi.object({
  participantCode: participantCode.optional(),
  currency: currency.optional(),
  limit: Joi.number().integer().min(1).max(500).default(100)
});
