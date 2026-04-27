import Joi from 'joi';

export const REASON_CODES = Object.freeze([
  'DUPL', // Duplicate payment
  'FRAD', // Fraudulent transaction
  'TECH', // Technical error / wrong execution
  'CUST', // Customer requested
  'RGLT', // Regulatory direction
  'RECON_FAILED' // Recovery worker concluded credit may have been applied with no record
]);

const uuidRule = Joi.string().pattern(/^[0-9a-f-]{36}$/i);

export const initiateBodySchema = Joi.object({
  originalTxId: uuidRule.required(),
  reasonCode: Joi.string().valid(...REASON_CODES).required(),
  reasonMessage: Joi.string().min(1).max(500).optional()
});

export const idParamSchema = Joi.object({
  id: uuidRule.required()
});

export const originalIdParamSchema = Joi.object({
  originalTxId: uuidRule.required()
});
