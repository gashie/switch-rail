import Joi from 'joi';

export const PARTICIPANT_TYPES = Object.freeze([
  'BANK',
  'WALLET',
  'FINTECH',
  'PSP',
  'FOREIGN_RAIL'
]);

export const PARTICIPANT_STATUSES = Object.freeze([
  'pending',
  'kyb',
  'certifying',
  'active',
  'suspended',
  'terminated'
]);

export const SUPPORTED_FORMATS = Object.freeze([
  'ISO20022',
  'ISO8583',
  'REST',
  'SWIFT_MT',
  'BULK_CSV',
  'BULK_XLSX',
  'BULK_PAIN001'
]);

const codeRule = Joi.string().pattern(/^[A-Z0-9_]{3,32}$/, 'participant-code');
const bicRule = Joi.string().pattern(
  /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/,
  'bic'
);

export const createSchema = Joi.object({
  code: codeRule.required(),
  name: Joi.string().min(1).max(140).required(),
  legalName: Joi.string().min(1).max(280).required(),
  type: Joi.string()
    .valid(...PARTICIPANT_TYPES)
    .required(),
  bic: bicRule.optional(),
  countryCode: Joi.string().length(2).uppercase().default('GH'),
  supportedFormats: Joi.array()
    .items(Joi.string().valid(...SUPPORTED_FORMATS))
    .default([]),
  endpoints: Joi.object().unknown(true).default({}),
  contactEmail: Joi.string().email({ tlds: { allow: false } }).optional(),
  contactPhone: Joi.string().max(32).optional(),
  metadata: Joi.object().unknown(true).default({})
});

export const updateSchema = Joi.object({
  name: Joi.string().min(1).max(140).optional(),
  legalName: Joi.string().min(1).max(280).optional(),
  bic: bicRule.optional().allow(null),
  countryCode: Joi.string().length(2).uppercase().optional(),
  supportedFormats: Joi.array()
    .items(Joi.string().valid(...SUPPORTED_FORMATS))
    .optional(),
  endpoints: Joi.object().unknown(true).optional(),
  contactEmail: Joi.string()
    .email({ tlds: { allow: false } })
    .allow(null)
    .optional(),
  contactPhone: Joi.string().max(32).allow(null).optional(),
  metadata: Joi.object().unknown(true).optional()
}).min(1);

export const listQuerySchema = Joi.object({
  status: Joi.string()
    .valid(...PARTICIPANT_STATUSES)
    .optional(),
  type: Joi.string()
    .valid(...PARTICIPANT_TYPES)
    .optional(),
  countryCode: Joi.string().length(2).uppercase().optional(),
  limit: Joi.number().integer().min(1).max(500).default(50),
  offset: Joi.number().integer().min(0).default(0)
});

export const codeParamSchema = Joi.object({ code: codeRule.required() });
