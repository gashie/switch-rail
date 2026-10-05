import Joi from 'joi';
import { REASON_CODES, OUTCOMES, MANUAL_RATIONALE_CODES } from './codes.js';
import { STATES } from './states.js';

const uuidRule = Joi.string().pattern(/^[0-9a-f-]{36}$/i);
const participantCodeRule = Joi.string().pattern(/^[A-Z0-9_]{3,32}$/);
const sha256HexRule = Joi.string().pattern(/^[0-9a-f]{64}$/i);

export const fileBodySchema = Joi.object({
  transactionId: uuidRule.required(),
  reasonCode: Joi.string().valid(...Object.values(REASON_CODES)).required(),
  filingParticipant: participantCodeRule.required(),
  filingUserRef: Joi.string().min(1).max(200).required(),
  verificationFingerprint: sha256HexRule.required(),
  evidence: Joi.object().unknown(true).optional(),
  amountOverride: Joi.string().pattern(/^\d+$/).optional()
});

export const listQuerySchema = Joi.object({
  state: Joi.string().valid(...Object.values(STATES)).optional(),
  reasonCode: Joi.string().valid(...Object.values(REASON_CODES)).optional(),
  filingParticipant: participantCodeRule.optional(),
  limit: Joi.number().integer().min(1).max(500).default(100),
  offset: Joi.number().integer().min(0).default(0)
});

export const killBodySchema = Joi.object({
  reason: Joi.string().min(1).max(500).required()
});

export const decisionBodySchema = Joi.object({
  outcome: Joi.string().valid(...Object.values(OUTCOMES)).required(),
  rationaleCode: Joi.string().valid(...MANUAL_RATIONALE_CODES).required(),
  rationaleNotes: Joi.string().min(1).max(2000).optional(),
  outcomeAmountMinor: Joi.string().pattern(/^\d+$/).optional()
});

export const confirmSettlementBodySchema = Joi.object({
  notes: Joi.string().min(1).max(500).optional()
});

export const evidenceUploadFieldsSchema = Joi.object({
  side: Joi.string().valid('FILER', 'RESPONDER', 'OPERATOR').required(),
  uploadedByParticipant: participantCodeRule.optional(),
  evidenceType: Joi.string().valid('DOCUMENT', 'STATEMENT', 'TRANSACTION_LOG', 'COMMUNICATION', 'OTHER').required(),
  description: Joi.string().min(1).max(1000).optional()
});

export const portalQuerySchema = Joi.object({
  fingerprint: sha256HexRule.required()
});

export const portalCommentBodySchema = Joi.object({
  fingerprint: sha256HexRule.required(),
  comment: Joi.string().min(1).max(2000).required()
});
