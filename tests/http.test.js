import { describe, expect, it } from 'vitest';
import express from 'express';
import Joi from 'joi';
import request from 'supertest';
import { ok, fail } from '../core/responses.js';
import { AppError, ERROR_CODES } from '../core/errors.js';
import { attachContext } from '../core/context.js';
import {
  asyncHandler,
  validateBody,
  validateQuery,
  sendOk,
  errorHandler
} from '../core/http.js';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(attachContext);

  app.get('/ping', (req, res) => sendOk(res, { pong: true, requestId: req.ctx.requestId }));

  app.post(
    '/echo',
    validateBody(Joi.object({ name: Joi.string().required() })),
    asyncHandler(async (req, res) => sendOk(res, { name: req.body.name }, 201))
  );

  app.get(
    '/search',
    validateQuery(Joi.object({ q: Joi.string().min(1).required() })),
    (req, res) => sendOk(res, { q: req.query.q })
  );

  app.get(
    '/boom',
    asyncHandler(async () => {
      throw new AppError('CONFLICT', 'thing already exists', 409, { reason: 'dup' });
    })
  );

  app.get(
    '/explode',
    asyncHandler(async () => {
      throw new Error('unexpected');
    })
  );

  app.use(errorHandler);
  return app;
};

describe('core/responses', () => {
  it('ok() returns the canonical envelope', () => {
    expect(ok({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
  });

  it('fail() omits details when not provided', () => {
    expect(fail('X', 'msg')).toEqual({ ok: false, error: { code: 'X', message: 'msg' } });
  });

  it('fail() includes details when provided', () => {
    expect(fail('X', 'msg', { f: 1 })).toEqual({
      ok: false,
      error: { code: 'X', message: 'msg', details: { f: 1 } }
    });
  });
});

describe('core/errors', () => {
  it('AppError carries code, status, and details', () => {
    const e = new AppError('NOT_FOUND', 'gone', 404, { id: 'x' });
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('NOT_FOUND');
    expect(e.status).toBe(404);
    expect(e.details).toEqual({ id: 'x' });
  });

  it('ERROR_CODES is frozen', () => {
    expect(Object.isFrozen(ERROR_CODES)).toBe(true);
    expect(ERROR_CODES.UNAUTHORIZED).toBe('UNAUTHORIZED');
  });
});

describe('core/context', () => {
  it('uses x-request-id header when present', async () => {
    const r = await request(buildApp()).get('/ping').set('x-request-id', 'rid-123');
    expect(r.body).toEqual({ ok: true, data: { pong: true, requestId: 'rid-123' } });
  });

  it('generates a request id when header missing', async () => {
    const r = await request(buildApp()).get('/ping');
    expect(r.body.ok).toBe(true);
    expect(r.body.data.requestId).toMatch(/[0-9a-f-]{36}/);
  });
});

describe('core/http', () => {
  it('validateBody accepts good input and forwards parsed body', async () => {
    const r = await request(buildApp()).post('/echo').send({ name: 'sika' });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ ok: true, data: { name: 'sika' } });
  });

  it('validateBody rejects bad input as VALIDATION_FAILED', async () => {
    const r = await request(buildApp()).post('/echo').send({ wrong: 'field' });
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(r.body.error.details)).toBe(true);
  });

  it('validateBody strips unknown keys', async () => {
    const r = await request(buildApp()).post('/echo').send({ name: 'sika', extra: 1 });
    expect(r.body.data).toEqual({ name: 'sika' });
  });

  it('validateQuery rejects missing required param', async () => {
    const r = await request(buildApp()).get('/search');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('errorHandler maps AppError to its status and shape', async () => {
    const r = await request(buildApp()).get('/boom');
    expect(r.status).toBe(409);
    expect(r.body).toEqual({
      ok: false,
      error: { code: 'CONFLICT', message: 'thing already exists', details: { reason: 'dup' } }
    });
  });

  it('errorHandler returns 500 INTERNAL for unknown errors', async () => {
    const r = await request(buildApp()).get('/explode');
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'internal server error' } });
  });

  it('asyncHandler forwards thrown errors to next()', async () => {
    const r = await request(buildApp()).get('/boom');
    expect(r.body.error.code).toBe('CONFLICT');
  });
});
