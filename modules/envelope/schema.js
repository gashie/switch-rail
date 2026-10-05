import Joi from 'joi';
import { crossBorderSchema } from './schema-crossborder.js';

export const MSG_TYPES = Object.freeze([
  'CRDT_TRF',
  'PMT_STATUS',
  'PMT_RETURN',
  'PMT_REVERSAL',
  'NAME_ENQ',
  // Phase 9 — cross-border credit transfer.
  'XB_CRDT_TRF'
]);

export const SOURCE_FORMATS = Object.freeze([
  'ISO20022',
  'ISO8583',
  'REST',
  'SWIFT_MT',
  'BULK_CSV',
  'BULK_XLSX',
  'BULK_PAIN001'
]);

export const ACCOUNT_TYPES = Object.freeze(['BANK_ACCOUNT', 'WALLET', 'ALIAS']);
export const SETTLEMENT_METHODS = Object.freeze(['CLRG', 'COVE', 'INDA', 'INGA']);
export const FEE_BEARERS = Object.freeze(['DEBT', 'CRED', 'SHAR']);

const bigintString = Joi.string().pattern(/^\d+$/, 'digit-string');
const uuidV7 = Joi.string().pattern(
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  'uuid-v7'
);

const partySchema = Joi.object({
  participantCode: Joi.string().min(1).max(64).required(),
  accountId: Joi.string().min(1).max(64).required(),
  accountType: Joi.string()
    .valid(...ACCOUNT_TYPES)
    .required(),
  name: Joi.string().min(1).max(140).required(),
  bic: Joi.string().pattern(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/, 'bic').optional(),
  countryCode: Joi.string().length(2).uppercase().optional()
}).unknown(false);

const amountSchema = Joi.object({
  value: bigintString.required(),
  currency: Joi.string().length(3).uppercase().required()
}).unknown(false);

const feeSchema = Joi.object({
  value: bigintString.required(),
  currency: Joi.string().length(3).uppercase().required(),
  bearer: Joi.string()
    .valid(...FEE_BEARERS)
    .required()
}).unknown(false);

const signatureSchema = Joi.object({
  kid: Joi.string().min(1).required(),
  alg: Joi.string().valid('Ed25519').required(),
  sigB64: Joi.string().base64().required()
}).unknown(false);

export const envelopeSchema = Joi.object({
  envelopeId: uuidV7.required(),
  msgVersion: Joi.string().valid('1.0').required(),
  msgType: Joi.string()
    .valid(...MSG_TYPES)
    .required(),
  createdAt: Joi.string().isoDate().required(),
  sourceFormat: Joi.string()
    .valid(...SOURCE_FORMATS)
    .required(),
  sourceMessageId: Joi.string().min(1).max(140).optional(),
  endToEndId: Joi.string().min(1).max(64).required(),
  idempotencyKey: Joi.string().min(8).max(128).required(),
  originator: partySchema.required(),
  beneficiary: partySchema.required(),
  amount: amountSchema.required(),
  fee: feeSchema.allow(null).optional(),
  reference: Joi.string().allow('').max(140).optional(),
  remittance: Joi.string().allow('').max(700).optional(),
  purposeCode: Joi.string().length(4).uppercase().optional(),
  settlementMethod: Joi.string()
    .valid(...SETTLEMENT_METHODS)
    .optional(),
  settlementDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/, 'iso-date').optional(),
  metadata: Joi.object().unknown(true).default({}),
  signature: signatureSchema.allow(null).optional(),
  // Phase 9 cross-border extension. Required iff msgType === 'XB_CRDT_TRF'.
  crossBorder: Joi.alternatives().conditional('msgType', {
    is: 'XB_CRDT_TRF',
    then: crossBorderSchema.required(),
    otherwise: Joi.forbidden()
  })
}).unknown(false);
