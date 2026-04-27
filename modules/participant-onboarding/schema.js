import Joi from 'joi';

export const KYB_DOC_TYPES = Object.freeze([
  'INCORPORATION',
  'BOG_LICENSE',
  'TAX_CERT',
  'BENEFICIAL_OWNERS',
  'AML_POLICY'
]);

export const CERT_SUITES = Object.freeze([
  'ENVELOPE_ROUNDTRIP',
  'CREDIT_LEG',
  'IDEMPOTENCY',
  'NAME_ENQUIRY'
]);

export const TRANSITION_TARGETS = Object.freeze([
  'kyb',
  'certifying',
  'active',
  'suspended',
  'terminated'
]);

export const REVIEW_STATUSES = Object.freeze(['approved', 'rejected']);

export const reviewBodySchema = Joi.object({
  status: Joi.string()
    .valid(...REVIEW_STATUSES)
    .required(),
  note: Joi.string().allow('').max(2000).optional()
});

export const transitionBodySchema = Joi.object({
  to: Joi.string()
    .valid(...TRANSITION_TARGETS)
    .required(),
  reason: Joi.string().allow('').max(500).optional()
});

export const kybUploadFieldsSchema = Joi.object({
  docType: Joi.string()
    .valid(...KYB_DOC_TYPES)
    .required()
});

export const codeParamSchema = Joi.object({
  code: Joi.string().pattern(/^[A-Z0-9_]{3,32}$/).required()
});
