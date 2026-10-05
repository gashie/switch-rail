import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, query } from '../core/db.js';
import { buildApp } from '../app.js';
import { config } from '../core/config.js';
import { participantsService } from '../modules/participants/index.js';
import { participantOnboardingService } from '../modules/participant-onboarding/index.js';
import { directoryService } from '../modules/directory/index.js';
import { cryptoKeysService } from '../modules/crypto-keys/index.js';
import { authService } from '../modules/auth/index.js';
import { transactionRecoveryWorker } from '../modules/transaction-recovery/index.js';

const PARTICIPANTS = [
  { code: 'P4E_BANK_O', type: 'BANK', countryCode: 'GH' },
  { code: 'P4E_BANK_B', type: 'BANK', countryCode: 'GH' },
  { code: 'P4E_TEST', type: 'BANK', countryCode: 'GH' }
];

const ADMIN_EMAIL = 'phase4-e2e-admin@sika.local';
const ADMIN_PASSWORD = 'phase4-e2e-pass-1234';

let app;
let server;
let baseUrl;
let agent;

const cleanup = async () => {
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'p4e-%'`);
  const codes = PARTICIPANTS.map((p) => p.code);
  await query(`DELETE FROM accounts WHERE participant_code = ANY($1)`, [codes]);
  await query(
    `DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code = ANY($1))`,
    [codes]
  );
  await query(
    `DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code = ANY($1))`,
    [codes]
  );
  await query(
    `DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id = ANY($1)`,
    [codes]
  );
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%'`);
  await query(`DELETE FROM settlement_positions WHERE participant_code = ANY($1)`, [codes]);
  await query(`DELETE FROM participants WHERE code = ANY($1)`, [codes]);
  await query(`DELETE FROM users WHERE email = $1`, [ADMIN_EMAIL]);
};

const onboardActive = async (def) => {
  await participantsService.create({
    code: def.code,
    name: def.code,
    legalName: `${def.code} PLC`,
    type: def.type,
    countryCode: def.countryCode
  });
  for (const dt of ['INCORPORATION', 'BOG_LICENSE', 'TAX_CERT', 'BENEFICIAL_OWNERS', 'AML_POLICY']) {
    await participantOnboardingService.uploadKyb({ code: def.code, docType: dt, fileName: `${dt}.pdf`, fileBuffer: Buffer.from('x'), uploadedBy: null });
    await participantOnboardingService.reviewKyb({ code: def.code, docType: dt, status: 'approved', reviewedBy: null });
  }
  await participantOnboardingService.transition({ code: def.code, to: 'certifying', actorId: null });
  for (const s of ['ENVELOPE_ROUNDTRIP', 'CREDIT_LEG', 'IDEMPOTENCY', 'NAME_ENQUIRY']) {
    await participantOnboardingService.runCertSuite({ code: def.code, suite: s });
  }
  await participantOnboardingService.transition({ code: def.code, to: 'active', actorId: null });
};

const setEndpoints = async (code, base) => {
  await query(
    `UPDATE participants SET endpoints = $2::jsonb, updated_at = now() WHERE code = $1`,
    [
      code,
      JSON.stringify({
        credit_leg: `${base}/simulator/${code}/credit-leg`,
        status_check: `${base}/simulator/${code}/status-check`,
        reversal: `${base}/simulator/${code}/reversal`
      })
    ]
  );
};

const buildEnv = ({ id, beneAccount, beneCode, beneName, idemSuffix }) => ({
  envelopeId: id,
  msgVersion: '1.0',
  msgType: 'CRDT_TRF',
  sourceFormat: 'REST',
  sourceMessageId: `p4e-${idemSuffix}`,
  endToEndId: `p4e-e2e-${idemSuffix}`,
  idempotencyKey: `p4e-idem-${idemSuffix}`,
  createdAt: new Date().toISOString(),
  originator: {
    participantCode: 'P4E_BANK_O',
    accountId: '0123000001',
    accountType: 'BANK_ACCOUNT',
    name: 'Originator',
    countryCode: 'GH'
  },
  beneficiary: {
    participantCode: beneCode,
    accountId: beneAccount,
    accountType: 'BANK_ACCOUNT',
    name: beneName,
    countryCode: 'GH'
  },
  amount: { value: '15000', currency: 'GHS' },
  reference: 'phase-4 e2e',
  purposeCode: 'GDDS',
  settlementMethod: 'CLRG'
});

beforeAll(async () => {
  await cleanup();
  app = buildApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  void config;

  await cryptoKeysService.ensureRailKey();
  for (const p of PARTICIPANTS) await onboardActive(p);
  for (const p of PARTICIPANTS) await setEndpoints(p.code, baseUrl);
  await directoryService.register({
    participantCode: 'P4E_BANK_O',
    accountType: 'BANK_ACCOUNT',
    accountNumber: '0123000001',
    accountName: 'Originator',
    currency: 'GHS'
  });
  await directoryService.register({
    participantCode: 'P4E_BANK_B',
    accountType: 'BANK_ACCOUNT',
    accountNumber: '0234000001',
    accountName: 'Beneficiary',
    currency: 'GHS'
  });
  for (const accountNumber of ['9999000002', '9999000007']) {
    await directoryService.register({
      participantCode: 'P4E_TEST',
      accountType: 'BANK_ACCOUNT',
      accountNumber,
      accountName: `Force ${accountNumber}`,
      currency: 'GHS'
    });
  }

  // Create + log in an admin user via the same HTTP surface the demo uses.
  await authService.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: 'Phase 4 E2E' });
  agent = request.agent(server);
  const login = await agent
    .post('/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (login.status !== 200) {
    throw new Error(`login failed: ${login.status} ${JSON.stringify(login.body)}`);
  }

  // The recovery worker would otherwise be running from the in-process index
  // module and racing with our per-test setup; stop it explicitly so each
  // test drives the lifecycle deterministically.
  await transactionRecoveryWorker.stop();
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await cleanup();
  await closePool();
});

describe('phase-4 — REST e2e through the monolith', () => {
  it('happy path: REST inbound → CONFIRMED, with two signed receipts', async () => {
    const env = buildEnv({
      id: '019aaaaa-0000-7000-8000-000000000001',
      beneCode: 'P4E_BANK_B',
      beneAccount: '0234000001',
      beneName: 'Beneficiary',
      idemSuffix: `happy-${Date.now()}`
    });

    const res = await agent.post('/adapters-rest/process').send(env);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.state).toBe('CONFIRMED');
    expect(res.body.data.responseCode).toBe('ACSC');
    expect(res.body.data.transactionId).toBeTruthy();

    const recRes = await agent.get(`/transaction-receipts/by-transaction/${res.body.data.transactionId}`);
    expect(recRes.status).toBe(200);
    expect(recRes.body.data.receipts.length).toBe(2);
  });

  it('insufficient funds (force account 9999000002) → REJECTED with INSUFFICIENT_FUNDS, no receipts', async () => {
    const env = buildEnv({
      id: '019aaaaa-0000-7000-8000-000000000002',
      beneCode: 'P4E_TEST',
      beneAccount: '9999000002',
      beneName: 'Force AM04',
      idemSuffix: `insuf-${Date.now()}`
    });

    const res = await agent.post('/adapters-rest/process').send(env);
    expect(res.body.data.state).toBe('REJECTED');
    expect(res.body.data.reasonCode).toBe('INSUFFICIENT_FUNDS');

    const recRes = await agent.get(`/transaction-receipts/by-transaction/${res.body.data.transactionId}`);
    expect(recRes.body.data.receipts.length).toBe(0);
  });

  it('timeout (9999000007) → PENDING_RECONCILIATION, then recovery drives terminal state', async () => {
    const env = buildEnv({
      id: '019aaaaa-0000-7000-8000-000000000003',
      beneCode: 'P4E_TEST',
      beneAccount: '9999000007',
      beneName: 'Force Timeout',
      idemSuffix: `timeout-${Date.now()}`
    });

    const res = await agent.post('/adapters-rest/process').send(env);
    expect(res.body.data.state).toBe('PENDING_RECONCILIATION');

    // Drive recovery in foreground, attempt-by-attempt — keeps the test
    // deterministic and avoids racing against a polling loop.
    const { transactionRecoveryService } = await import('../modules/transaction-recovery/index.js');
    let final = res.body.data;
    for (let i = 0; i < 5; i += 1) {
      await query(
        `UPDATE transactions SET next_attempt_at = now() - interval '1 second' WHERE id = $1`,
        [res.body.data.transactionId]
      );
      const out = await transactionRecoveryService.runOnceForId(res.body.data.transactionId);
      final = out.transaction || final;
      if (out.terminal) break;
    }
    // Force account 9999000007 returns "pending" on status-check, so 5
    // exhausted PENDING outcomes land us in REJECTED with TIMEOUT.
    expect(final.state).toBe('REJECTED');
    expect(final.reason_code).toBe('TIMEOUT');
  });

  it('reversal of a CONFIRMED transaction unwinds it to REVERSED', async () => {
    const env = buildEnv({
      id: '019aaaaa-0000-7000-8000-000000000004',
      beneCode: 'P4E_BANK_B',
      beneAccount: '0234000001',
      beneName: 'Beneficiary',
      idemSuffix: `rev-${Date.now()}`
    });

    const res = await agent.post('/adapters-rest/process').send(env);
    expect(res.body.data.state).toBe('CONFIRMED');
    const txId = res.body.data.transactionId;

    const revRes = await agent
      .post('/reversals')
      .send({ originalTxId: txId, reasonCode: 'CUST', reasonMessage: 'phase-4 e2e reversal' });
    expect(revRes.status).toBe(201);
    expect(revRes.body.data.reversal.state).toBe('CONFIRMED');
    expect(revRes.body.data.original.state).toBe('REVERSED');
  });

  it('idempotency: re-posting the same envelope returns the same transaction', async () => {
    const idem = `idem-${Date.now()}`;
    const envBody = buildEnv({
      id: '019aaaaa-0000-7000-8000-000000000005',
      beneCode: 'P4E_BANK_B',
      beneAccount: '0234000001',
      beneName: 'Beneficiary',
      idemSuffix: idem
    });

    const a = await agent.post('/adapters-rest/process').send(envBody);
    expect(a.body.data.state).toBe('CONFIRMED');
    const b = await agent.post('/adapters-rest/process').send(envBody);
    expect(b.body.data.transactionId).toBe(a.body.data.transactionId);
    expect(b.body.data.deduped).toBe(true);
  });
});
