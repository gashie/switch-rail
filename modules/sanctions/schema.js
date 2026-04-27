import Joi from 'joi';

export const SOURCES = Object.freeze(['OFAC', 'UN', 'EU', 'BOG', 'FIC', 'INTERNAL']);
export const LIST_TYPES = Object.freeze(['SANCTIONS', 'PEP', 'GREYLIST', 'BLACKLIST']);
export const MATCH_TYPES = Object.freeze(['STRONG_MATCH', 'WEAK_MATCH', 'GHANACARD_MATCH', 'ACCOUNT_MATCH']);

const uuidRule = Joi.string().pattern(/^[0-9a-f-]{36}$/i);

export const screenBodySchema = Joi.object({
  name: Joi.string().min(1).max(200).required(),
  accountNumber: Joi.string().min(1).max(64).optional(),
  ghanacardPin: Joi.string().min(5).max(32).optional(),
  party: Joi.string().valid('ORIGINATOR', 'BENEFICIARY').default('BENEFICIARY'),
  transactionId: uuidRule.optional()
});

export const upsertEntryBodySchema = Joi.object({
  source: Joi.string().valid(...SOURCES).required(),
  listType: Joi.string().valid(...LIST_TYPES).required(),
  sourceRecordId: Joi.string().min(1).max(140).optional(),
  primaryName: Joi.string().min(1).max(200).required(),
  aliases: Joi.array().items(Joi.string().min(1).max(200)).default([]),
  countries: Joi.array().items(Joi.string().length(2).uppercase()).optional(),
  dateOfBirth: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ghanacardPin: Joi.string().min(5).max(32).optional(),
  accountNumbers: Joi.array().items(Joi.string().min(1).max(64)).optional(),
  reason: Joi.string().min(1).max(500).optional(),
  metadata: Joi.object().unknown(true).default({})
});

export const listEntriesQuerySchema = Joi.object({
  source: Joi.string().valid(...SOURCES).optional(),
  listType: Joi.string().valid(...LIST_TYPES).optional(),
  active: Joi.boolean().default(true),
  limit: Joi.number().integer().min(1).max(500).default(100)
});

export const idParamSchema = Joi.object({
  id: uuidRule.required()
});
