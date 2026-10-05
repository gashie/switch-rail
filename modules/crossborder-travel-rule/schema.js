import Joi from 'joi';
import { ID_TYPES, PURPOSE_OF_PAYMENT, DIRECTIONS } from './codes.js';

const country = Joi.string().length(2).uppercase();
const sha256Hash = Joi.string().pattern(/^(sha256:)?[0-9a-f]{64}$/i);

export const enforceBodySchema = Joi.object({
  direction: Joi.string().valid(...DIRECTIONS).required(),
  crossborderTxId: Joi.string().pattern(/^[0-9a-f-]{36}$/i).optional(),
  transactionId: Joi.string().pattern(/^[0-9a-f-]{36}$/i).optional(),
  travelRule: Joi.object({
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
  }).required(),
  // Names + countries flow through to sanctions screening.
  originatorName: Joi.string().min(1).max(200).required(),
  beneficiaryName: Joi.string().min(1).max(200).required()
});

export const listQuerySchema = Joi.object({
  crossborderTxId: Joi.string().pattern(/^[0-9a-f-]{36}$/i).optional(),
  direction: Joi.string().valid(...DIRECTIONS).optional(),
  limit: Joi.number().integer().min(1).max(500).default(100)
});
