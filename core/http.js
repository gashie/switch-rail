import { ok, fail } from './responses.js';
import { AppError } from './errors.js';

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const validateBody = (schema) => (req, _res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });
  if (error) {
    return next(new AppError('VALIDATION_FAILED', 'invalid body', 400, error.details));
  }
  req.body = value;
  next();
};

export const validateQuery = (schema) => (req, _res, next) => {
  const { error, value } = schema.validate(req.query, {
    abortEarly: false,
    stripUnknown: true
  });
  if (error) {
    return next(new AppError('VALIDATION_FAILED', 'invalid query', 400, error.details));
  }
  req.query = value;
  next();
};

export const sendOk = (res, data, status = 200) => res.status(status).json(ok(data));

const SESSION_COOKIE_DEFAULTS = Object.freeze({
  httpOnly: true,
  sameSite: 'lax',
  signed: true,
  path: '/'
});

export const setSessionCookie = (res, name, value, opts = {}) =>
  res.cookie(name, value, { ...SESSION_COOKIE_DEFAULTS, ...opts });

export const clearSessionCookie = (res, name) => res.clearCookie(name, { path: '/' });

export const errorHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json(fail(err.code, err.message, err.details));
  }
  // Log the underlying error to stderr so operators can debug 500s. Body
  // stays opaque to clients.
  console.error('[errorHandler]', err?.stack || err?.message || err);
  return res.status(500).json(fail('INTERNAL', 'internal server error'));
};
