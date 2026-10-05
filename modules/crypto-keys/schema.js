import Joi from 'joi';

export const ownerSchema = Joi.object({
  ownerType: Joi.string().valid('rail', 'participant').required(),
  ownerId: Joi.string().max(256).allow(null).optional()
});

export const listQuerySchema = Joi.object({
  ownerType: Joi.string().valid('rail', 'participant').required(),
  ownerId: Joi.string().max(256).optional()
});
