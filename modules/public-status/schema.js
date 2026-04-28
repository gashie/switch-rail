import Joi from 'joi';

export const declareIncidentSchema = Joi.object({
  scope: Joi.string().valid('GLOBAL', 'RAIL', 'PARTICIPANT', 'CROSSBORDER').required(),
  severity: Joi.string().valid('INFO', 'MINOR', 'MAJOR', 'CRITICAL').required(),
  title: Joi.string().min(1).max(200).required(),
  description: Joi.string().max(2000).allow('', null),
  metadata: Joi.object().default({})
}).unknown(false);

export const incidentUpdateSchema = Joi.object({
  body: Joi.string().min(1).max(2000).required()
}).unknown(false);

export const resolveIncidentSchema = Joi.object({
  closingNote: Joi.string().min(1).max(2000).required()
}).unknown(false);

export const verifyReceiptSchema = Joi.object({
  transactionId: Joi.string().uuid().required()
}).unknown(false);
