import Joi from 'joi';

export const FEE_TYPES = Object.freeze(['FLAT', 'PERCENTAGE', 'TIERED']);
export const BEARERS = Object.freeze(['DEBT', 'CRED', 'SHAR']);

const currency = Joi.string().length(3).uppercase();
const bigintMinor = Joi.alternatives().try(
  Joi.string().pattern(/^\d+$/, 'digit-string'),
  Joi.number().integer().min(0)
);

const tierSchema = Joi.object({
  fromMinor: bigintMinor.required(),
  toMinor: bigintMinor.optional(), // null = open-ended top tier
  feeMinor: bigintMinor.optional(),
  feeBps: Joi.number().integer().min(0).max(10000).optional()
}).or('feeMinor', 'feeBps');

export const publishScheduleBodySchema = Joi.object({
  scheduleCode: Joi.string().min(3).max(64).required(),
  railClass: Joi.string().min(3).max(64).required(),
  currency: currency.required(),
  feeType: Joi.string().valid(...FEE_TYPES).required(),
  flatMinor: bigintMinor.optional(),
  pctBps: Joi.number().integer().min(0).max(10000).optional(),
  tiers: Joi.array().items(tierSchema).optional(),
  minFeeMinor: bigintMinor.default('0'),
  maxFeeMinor: bigintMinor.optional(),
  bearer: Joi.string().valid(...BEARERS).default('DEBT'),
  effectiveFrom: Joi.string().isoDate().optional()
}).custom((value, helpers) => {
  if (value.feeType === 'FLAT' && value.flatMinor == null) {
    return helpers.error('any.invalid', { message: 'FLAT requires flatMinor' });
  }
  if (value.feeType === 'PERCENTAGE' && value.pctBps == null) {
    return helpers.error('any.invalid', { message: 'PERCENTAGE requires pctBps' });
  }
  if (value.feeType === 'TIERED' && (!value.tiers || value.tiers.length === 0)) {
    return helpers.error('any.invalid', { message: 'TIERED requires tiers' });
  }
  return value;
});

export const calculateBodySchema = Joi.object({
  railClass: Joi.string().min(3).max(64).required(),
  currency: currency.required(),
  amountMinor: bigintMinor.required(),
  asOf: Joi.string().isoDate().optional()
});

export const listSchedulesQuerySchema = Joi.object({
  railClass: Joi.string().min(3).max(64).optional(),
  currency: currency.optional(),
  active: Joi.boolean().optional()
});
