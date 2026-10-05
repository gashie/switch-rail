import Joi from 'joi';

export const loginSchema = Joi.object({
  email: Joi.string().email({ tlds: { allow: false } }).required(),
  password: Joi.string().min(1).required()
});

export const passwordChangeSchema = Joi.object({
  current: Joi.string().required(),
  new: Joi.string().min(8).required()
});
