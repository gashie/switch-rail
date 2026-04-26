import { AppError } from '../../core/errors.js';
import { envelopeSchema } from './schema.js';

export const validateEnvelope = (env) => {
  const { error, value } = envelopeSchema.validate(env, {
    abortEarly: false,
    stripUnknown: false,
    convert: false
  });
  if (error) return { ok: false, error: error.details };
  return { ok: true, value };
};

export const assertEnvelope = (env) => {
  const r = validateEnvelope(env);
  if (!r.ok) throw new AppError('VALIDATION_FAILED', 'invalid envelope', 400, r.error);
  return r.value;
};
