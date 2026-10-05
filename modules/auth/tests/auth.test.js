import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { config } from '../../../core/config.js';
import { attachContext } from '../../../core/context.js';
import { errorHandler } from '../../../core/http.js';
import { closePool, query } from '../../../core/db.js';
import { hashPassword } from '../../../core/crypto.js';
import { uuidv7 } from '../../../core/uuid.js';
import authRoutes from '../routes.js';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser(config.cookieSecret));
  app.use(attachContext);
  app.use('/auth', authRoutes);
  app.use(errorHandler);
  return app;
};

const TEST_EMAIL = 'auth.test@sika.local';
const TEST_PASSWORD = 'password123!';
let testUserId;

beforeAll(async () => {
  const passwordHash = await hashPassword(TEST_PASSWORD);
  testUserId = uuidv7();
  await query(`DELETE FROM users WHERE email = $1`, [TEST_EMAIL]);
  await query(
    `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)`,
    [testUserId, TEST_EMAIL, passwordHash, 'Auth Test']
  );
});

afterAll(async () => {
  await query(`DELETE FROM sessions WHERE user_id = $1`, [testUserId]);
  await query(`DELETE FROM users WHERE id = $1`, [testUserId]);
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM sessions WHERE user_id = $1`, [testUserId]);
});

describe('auth — login', () => {
  it('returns user and sets a signed session cookie on valid credentials', async () => {
    const r = await request(buildApp())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.data.user.email).toBe(TEST_EMAIL);
    expect(r.body.data.user.password_hash).toBeUndefined();
    expect(r.headers['set-cookie']).toBeDefined();
    expect(r.headers['set-cookie'][0]).toMatch(/sika_session=/);
    expect(r.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
  });

  it('rejects a wrong password with 401 UNAUTHORIZED', async () => {
    const r = await request(buildApp())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: 'wrong' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an unknown email with 401 UNAUTHORIZED (no enumeration)', async () => {
    const r = await request(buildApp())
      .post('/auth/login')
      .send({ email: 'no-such-user@sika.local', password: TEST_PASSWORD });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects malformed bodies with VALIDATION_FAILED', async () => {
    const r = await request(buildApp()).post('/auth/login').send({ email: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('auth — me', () => {
  it('returns 401 when no session cookie is present', async () => {
    const r = await request(buildApp()).get('/auth/me');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns the user when called with a valid signed cookie', async () => {
    const agent = request.agent(buildApp());
    await agent.post('/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const r = await agent.get('/auth/me');
    expect(r.status).toBe(200);
    expect(r.body.data.user.email).toBe(TEST_EMAIL);
  });

  it('returns 401 when the session has been revoked', async () => {
    const agent = request.agent(buildApp());
    await agent.post('/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    await query(`DELETE FROM sessions WHERE user_id = $1`, [testUserId]);
    const r = await agent.get('/auth/me');
    expect(r.status).toBe(401);
  });
});

describe('auth — logout', () => {
  it('clears the session row and the cookie can no longer be reused', async () => {
    const agent = request.agent(buildApp());
    await agent.post('/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const lo = await agent.post('/auth/logout');
    expect(lo.status).toBe(200);
    expect(lo.body.data.logout).toBe(true);
    const me = await agent.get('/auth/me');
    expect(me.status).toBe(401);
  });
});

describe('auth — password change', () => {
  it('changes the password when current is correct, then accepts the new one', async () => {
    const agent = request.agent(buildApp());
    await agent.post('/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const r = await agent.post('/auth/password').send({ current: TEST_PASSWORD, new: 'newPasswordABC' });
    expect(r.status).toBe(200);

    const r2 = await request(buildApp())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: 'newPasswordABC' });
    expect(r2.status).toBe(200);

    const restoreAgent = request.agent(buildApp());
    await restoreAgent.post('/auth/login').send({ email: TEST_EMAIL, password: 'newPasswordABC' });
    const restore = await restoreAgent.post('/auth/password').send({
      current: 'newPasswordABC',
      new: TEST_PASSWORD
    });
    expect(restore.status).toBe(200);
  });

  it('rejects when current password is wrong', async () => {
    const agent = request.agent(buildApp());
    await agent.post('/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const r = await agent.post('/auth/password').send({ current: 'wrong', new: 'newPasswordABC' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });

  it('requires authentication', async () => {
    const r = await request(buildApp())
      .post('/auth/password')
      .send({ current: 'a', new: 'newPasswordABC' });
    expect(r.status).toBe(401);
  });

  it('rejects a too-short new password with VALIDATION_FAILED', async () => {
    const agent = request.agent(buildApp());
    await agent.post('/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const r = await agent.post('/auth/password').send({ current: TEST_PASSWORD, new: 'short' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });
});
