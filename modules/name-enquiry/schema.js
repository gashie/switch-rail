import Joi from 'joi';

const aliasInput = Joi.object({
  aliasType: Joi.string().valid('PHONE', 'EMAIL', 'GHANACARD', 'MERCHANT', 'HANDLE').required(),
  aliasValue: Joi.string().min(1).max(140).required()
}).unknown(false);

const accountInput = Joi.object({
  participantCode: Joi.string().pattern(/^[A-Z0-9_]{3,32}$/).required(),
  accountNumber: Joi.string().min(1).max(64).required()
}).unknown(false);

const bicInput = Joi.object({
  bic: Joi.string().pattern(/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/).required(),
  accountNumber: Joi.string().min(1).max(64).required()
}).unknown(false);

export const inputUnion = Joi.alternatives().try(aliasInput, accountInput, bicInput).required();

export const resolveBodySchema = Joi.object({
  input: inputUnion
}).unknown(false);
