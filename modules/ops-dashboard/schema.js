import Joi from 'joi';

export const listSnapshotsSchema = Joi.object({
  metricKind: Joi.string().min(1).max(64),
  fromMinute: Joi.string().isoDate(),
  toMinute: Joi.string().isoDate(),
  limit: Joi.number().integer().min(1).max(2000).default(500)
}).unknown(false);

export const recordSnapshotSchema = Joi.object({
  metricKind: Joi.string().min(1).max(64).required(),
  bucketMinute: Joi.string().isoDate().required(),
  railClass: Joi.string().valid('DOMESTIC_INSTANT', 'DOMESTIC_BATCH', 'CROSSBORDER').allow(null),
  valueNumeric: Joi.alternatives(Joi.number(), Joi.string()).allow(null),
  valueCount: Joi.number().integer().allow(null),
  payload: Joi.object().default({})
}).unknown(false);

export const summarySchema = Joi.object({
  windowMinutes: Joi.number().integer().min(1).max(1440).default(60)
}).unknown(false);
