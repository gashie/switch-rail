import Joi from 'joi';
import { REJECTION_REASONS, DEFAULT_EXPIRY_HOURS, MIN_EXPIRY_HOURS, MAX_EXPIRY_DAYS } from './codes.js';

const uuidRule = Joi.string().pattern(/^[0-9a-f-]{36}$/i);
const participantCodeRule = Joi.string().pattern(/^[A-Z0-9_]{3,32}$/);
const amountMinor = Joi.string().pattern(/^\d+$/);

export const createBodySchema = Joi.object({
  requesterParticipant: participantCodeRule.required(),
  requesterAccountNumber: Joi.string().min(1).max(64).required(),
  payerParticipant: participantCodeRule.required(),
  payerAccountNumber: Joi.string().min(1).max(64).optional(),
  payerAliasType: Joi.string().valid('PHONE', 'EMAIL', 'NIA', 'GHCARD').optional(),
  payerAliasValue: Joi.string().min(1).max(140).optional(),
  amountMinor: amountMinor.required(),
  currency: Joi.string().length(3).uppercase().required(),
  reason: Joi.string().min(1).max(280).optional(),
  reference: Joi.string().min(1).max(140).optional(),
  expiresInHours: Joi.number().integer().min(MIN_EXPIRY_HOURS).max(MAX_EXPIRY_DAYS * 24).default(DEFAULT_EXPIRY_HOURS),
  idempotencyKey: Joi.string().min(8).max(128).optional()
});

export const authorizeBodySchema = Joi.object({
  payerAccountNumber: Joi.string().min(1).max(64).required(),
  payerName: Joi.string().min(1).max(140).required()
});

export const rejectBodySchema = Joi.object({
  reason: Joi.string().valid(...REJECTION_REASONS).required(),
  notes: Joi.string().min(1).max(500).optional()
});

export const listQuerySchema = Joi.object({
  payerParticipant: participantCodeRule.optional(),
  requesterParticipant: participantCodeRule.optional(),
  state: Joi.string().valid('PENDING', 'AUTHORIZED', 'PAID', 'REJECTED', 'EXPIRED').optional(),
  limit: Joi.number().integer().min(1).max(500).default(100),
  offset: Joi.number().integer().min(0).default(0)
});

export const requestNumberSchema = Joi.object({
  requestNumber: Joi.string().pattern(/^R2P-\d{6}-\d{6}$/).required()
});

void uuidRule;
