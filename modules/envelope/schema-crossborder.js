// Phase 9 cross-border envelope extension. Locked shape per PHASES/PHASE-9.md.
// Validated at envelope ingestion via factory.js when msgType === 'XB_CRDT_TRF'.

import Joi from 'joi';

export const ID_TYPES = Object.freeze([
  'GHANACARD',
  'PASSPORT',
  'NATIONAL_ID',
  'CORPORATE_REG'
]);

export const PURPOSE_OF_PAYMENT = Object.freeze([
  'TRADE_GOODS',
  'TRADE_SERVICES',
  'REMITTANCE_FAMILY',
  'EDUCATION',
  'MEDICAL',
  'INVESTMENT',
  'OTHER'
]);

export const SETTLEMENT_ASSET_TYPES = Object.freeze([
  'LOCAL_CURRENCY_NET',
  'CBDC',
  'STABLECOIN'
]);

const bigintString = Joi.string().pattern(/^\d+$/);
const country = Joi.string().length(2).uppercase();
const currency = Joi.string().length(3).uppercase();
const sha256Hash = Joi.string().pattern(/^(sha256:)?[0-9a-f]{64}$/i);

const fxSchema = Joi.object({
  payCurrency: currency.required(),
  receiveCurrency: currency.required(),
  lockedRate: Joi.string().pattern(/^\d+(\.\d+)?$/).required(),
  lockedAt: Joi.string().isoDate().required(),
  lockExpiresAt: Joi.string().isoDate().required(),
  quoteId: Joi.string().pattern(/^[0-9a-f-]{36}$/i).required(),
  payAmount: bigintString.required(),
  receiveAmount: bigintString.required()
}).unknown(false);

const travelRuleSchema = Joi.object({
  originatorIdType: Joi.string().valid(...ID_TYPES).required(),
  originatorIdHashed: sha256Hash.required(),
  originatorAddress: Joi.string().min(1).max(500).required(),
  originatorDateOfBirth: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  beneficiaryIdType: Joi.string().valid(...ID_TYPES).required(),
  beneficiaryIdHashed: sha256Hash.required(),
  beneficiaryAddress: Joi.string().min(1).max(500).required(),
  beneficiaryDateOfBirth: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  purposeOfPayment: Joi.string().valid(...PURPOSE_OF_PAYMENT).required(),
  jurisdictionOfOriginator: country.required(),
  jurisdictionOfBeneficiary: country.required()
}).unknown(false);

export const crossBorderSchema = Joi.object({
  foreignRailCode: Joi.string().pattern(/^[A-Z0-9_]{3,32}$/).required(),
  originatorCountry: country.required(),
  beneficiaryCountry: country.required(),
  fx: fxSchema.required(),
  travelRule: travelRuleSchema.required(),
  settlementAssetType: Joi.string().valid(...SETTLEMENT_ASSET_TYPES).default('LOCAL_CURRENCY_NET')
}).unknown(false);

// Cross-cutting validation: lockExpiresAt must be in the future at ingestion.
export const validateCrossBorderTiming = (env) => {
  if (env.msgType !== 'XB_CRDT_TRF') return null;
  const xb = env.crossBorder;
  if (!xb) return 'XB_CRDT_TRF requires crossBorder';
  const exp = new Date(xb.fx.lockExpiresAt).getTime();
  if (!Number.isFinite(exp) || exp <= Date.now()) {
    return `crossBorder.fx.lockExpiresAt must be in the future (got ${xb.fx.lockExpiresAt})`;
  }
  return null;
};
