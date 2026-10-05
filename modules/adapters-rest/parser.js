import { AppError } from '../../core/errors.js';
import { assertEnvelope } from '../envelope/index.js';

export const parseRest = (jsonBody) => {
  if (jsonBody === null || typeof jsonBody !== 'object' || Array.isArray(jsonBody)) {
    throw new AppError('VALIDATION_FAILED', 'REST inbound body must be a JSON object', 400);
  }
  return assertEnvelope(jsonBody);
};
