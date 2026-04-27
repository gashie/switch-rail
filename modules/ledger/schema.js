import Joi from 'joi';
import { ACCOUNT_TYPES, JOURNAL_REASONS, SIDES } from './codes.js';

const bigintMinor = Joi.alternatives().try(
  Joi.string().pattern(/^-?\d+$/, 'digit-string'),
  Joi.number().integer()
);

const currency = Joi.string().length(3).uppercase();

const entrySchema = Joi.object({
  accountCode: Joi.string().min(3).max(96).required(),
  side: Joi.string().valid(...Object.values(SIDES)).required(),
  amount: bigintMinor.required(),
  currency: currency.required()
}).unknown(false);

export const postJournalBodySchema = Joi.object({
  reason: Joi.string().valid(...Object.values(JOURNAL_REASONS)).required(),
  referenceType: Joi.string().min(1).max(32).optional(),
  referenceId: Joi.string().min(1).max(64).optional(),
  operatingDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  entries: Joi.array().items(entrySchema).min(2).required(),
  metadata: Joi.object().unknown(true).default({})
});

export const ensureAccountBodySchema = Joi.object({
  accountType: Joi.string().valid(...Object.values(ACCOUNT_TYPES)).required(),
  ownerId: Joi.string().min(1).max(64).optional(),
  currency: currency.required(),
  metadata: Joi.object().unknown(true).default({})
});

export const listAccountsQuerySchema = Joi.object({
  ownerType: Joi.string().valid('PARTICIPANT', 'RAIL').optional(),
  ownerId: Joi.string().min(1).max(64).optional(),
  currency: currency.optional(),
  accountType: Joi.string().valid(...Object.values(ACCOUNT_TYPES)).optional()
});

export const accountCodeParamSchema = Joi.object({
  code: Joi.string().min(3).max(96).required()
});

export const journalIdParamSchema = Joi.object({
  id: Joi.string().pattern(/^[0-9a-f-]{36}$/i).required()
});

export const dateParamSchema = Joi.object({
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required()
});
