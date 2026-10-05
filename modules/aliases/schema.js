import Joi from 'joi';

export const ALIAS_TYPES = Object.freeze([
  'PHONE',
  'EMAIL',
  'GHANACARD',
  'MERCHANT',
  'HANDLE'
]);

export const ALIAS_STATUSES = Object.freeze(['pending', 'verified', 'revoked']);

export const VERIFICATION_METHODS = Object.freeze([
  'OTP',
  'EMAIL_LINK',
  'NIA',
  'TIN_FORMAT',
  'OPERATOR'
]);

export const RESERVED_HANDLES = Object.freeze([
  'admin',
  'administrator',
  'support',
  'rail',
  'sika',
  'ghipss',
  'bog',
  'fic',
  'root',
  'system',
  'operator'
]);

export const registerSchema = Joi.object({
  aliasType: Joi.string()
    .valid(...ALIAS_TYPES)
    .required(),
  aliasValue: Joi.string().min(1).max(140).required(),
  accountId: Joi.string()
    .pattern(/^[0-9a-f-]{36}$/i)
    .required()
});

export const resolveQuerySchema = Joi.object({
  aliasType: Joi.string()
    .valid(...ALIAS_TYPES)
    .required(),
  aliasValue: Joi.string().min(1).max(140).required()
});

export const aliasIdParamSchema = Joi.object({
  id: Joi.string().pattern(/^[0-9a-f-]{36}$/i).required()
});

export const accountIdParamSchema = Joi.object({
  accountId: Joi.string().pattern(/^[0-9a-f-]{36}$/i).required()
});
