import { uuidv7 } from '../../core/uuid.js';
import { AppError } from '../../core/errors.js';
import { envelopeSchema } from './schema.js';
import { validateCrossBorderTiming } from './schema-crossborder.js';

export const freezeEnvelope = (env) => {
  if (env === null || typeof env !== 'object' || Object.isFrozen(env)) return env;
  for (const key of Object.keys(env)) freezeEnvelope(env[key]);
  return Object.freeze(env);
};

export const createEnvelope = (input = {}) => {
  const enriched = { ...input };
  if (!enriched.envelopeId) enriched.envelopeId = uuidv7();
  if (!enriched.msgVersion) enriched.msgVersion = '1.0';
  if (!enriched.createdAt) enriched.createdAt = new Date().toISOString();
  if (!enriched.metadata) enriched.metadata = {};

  const { error, value } = envelopeSchema.validate(enriched, {
    abortEarly: false,
    stripUnknown: false,
    convert: false
  });
  if (error) {
    throw new AppError('VALIDATION_FAILED', 'invalid envelope', 400, error.details);
  }
  // Phase 9 cross-border timing check — Joi can't easily express "must be in
  // the future" because timestamps are wall-clock dependent. Enforce here.
  const timingError = validateCrossBorderTiming(value);
  if (timingError) {
    throw new AppError('VALIDATION_FAILED', timingError, 400);
  }
  return freezeEnvelope(value);
};
