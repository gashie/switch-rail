import Joi from 'joi';

export const PARTIES = Object.freeze(['ORIGINATOR', 'BENEFICIARY']);

const uuidRule = Joi.string().pattern(/^[0-9a-f-]{36}$/i);

export const idParamSchema = Joi.object({
  txId: uuidRule.required()
});

export const verifyBodySchema = Joi.object({
  payload: Joi.object().required(),
  signature: Joi.string().min(1).required(),
  kid: Joi.string().min(1).required()
});

export const listQuerySchema = Joi.object({
  participantCode: Joi.string().pattern(/^[A-Z0-9_]{3,32}$/).optional(),
  limit: Joi.number().integer().min(1).max(500).default(100),
  offset: Joi.number().integer().min(0).default(0)
});
