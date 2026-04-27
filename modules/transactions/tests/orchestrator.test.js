import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { errorHandler } from '../../../core/http.js';
import { attachContext } from '../../../core/context.js';
import { createEnvelope } from '../../envelope/index.js';
import { participantsService } from '../../participants/index.js';
import { participantOnboardingService } from '../../participant-onboarding/index.js';
import { participantSimulatorRoutes } from '../../participant-simulator/index.js';
import { directoryService } from '../../directory/index.js';
import { cryptoKeysService } from '../../crypto-keys/index.js';
import { transactionsOrchestrator, transactionsService } from '../index.js';

const ORIG = 'ORC_BANK_O';
const BENE = 'ORC_BANK_B';
let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'orc-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%'`);
  await query(`DELETE FROM participants WHERE code IN ($1,$2)`, [ORIG, BENE]);
};

const onboardActive = async (code) => {
  await participantsService.create({
    code,
    name: code,
    legalName: `${code} PLC`,
    type: 'BANK',
    countryCode: 'GH'
  });
  for (const dt of ['INCORPORATION', 'BOG_LICENSE', 'TAX_CERT', 'BENEFICIAL_OWNERS', 'AML_POLICY']) {
    await participantOnboardingService.uploadKyb({ code, docType: dt, fileName: `${dt}.pdf`, fileBuffer: Buffer.from('x'), uploadedBy: null });
    await participantOnboardingService.reviewKyb({ code, docType: dt, status: 'approved', reviewedBy: null });
  }
  await participantOnboardingService.transition({ code, to: 'certifying', actorId: null });
  for (const s of ['ENVELOPE_ROUNDTRIP', 'CREDIT_LEG', 'IDEMPOTENCY', 'NAME_ENQUIRY']) {
    await participantOnboardingService.runCertSuite({ code, suite: s });
  }
  await participantOnboardingService.transition({ code, to: 'active', actorId: null });
};

const setBeneEndpoints = async (code, base) => {
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

const buildEnv = (beneAccount, idx) =>
  createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'REST',
    sourceMessageId: `orc-${Date.now()}-${idx}`,
    endToEndId: `orc-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `orc-idem-${Date.now()}-${idx}`,
    originator: {
      participantCode: ORIG,
      accountId: '0123000001',
      accountType: 'BANK_ACCOUNT',
      name: 'Originator'
    },
    beneficiary: {
      participantCode: BENE,
      accountId: beneAccount,
      accountType: 'BANK_ACCOUNT',
      name: 'Beneficiary'
    },
    amount: { value: '15000', currency: 'GHS' }
  });

beforeAll(async () => {
  await cleanup();
  await onboardActive(ORIG);
  await onboardActive(BENE);
  await directoryService.register({
    participantCode: ORIG,
    accountType: 'BANK_ACCOUNT',
    accountNumber: '0123000001',
    accountName: 'Originator',
    currency: 'GHS'
  });
  await cryptoKeysService.ensureRailKey();
  // Boot the simulator on an ephemeral port.
  const app = express();
  app.use(express.json());
  app.use(attachContext);
  app.use('/simulator', participantSimulatorRoutes);
  app.use(errorHandler);
  await new Promise((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await setBeneEndpoints(BENE, baseUrl);
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await cleanup();
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM accounts WHERE participant_code = $1 AND account_number LIKE '02%'`, [BENE]);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'orc-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%'`);
});

const ensureBeneAccount = async (account, status = 'active') => {
  await directoryService.register({
    participantCode: BENE,
    accountType: 'BANK_ACCOUNT',
    accountNumber: account,
    accountName: 'Beneficiary',
    currency: 'GHS'
  });
  if (status !== 'active') {
    if (status === 'frozen') {
      await directoryService.freeze({ participantCode: BENE, accountNumber: account });
    } else if (status === 'closed') {
      await directoryService.close({ participantCode: BENE, accountNumber: account });
    }
  }
};

describe('orchestrator — happy path', () => {
  it('walks RECEIVED → AUTHORIZED → ROUTED → CREDIT_LEG_PENDING → CONFIRMED', async () => {
    await ensureBeneAccount('0234000001');
    const env = buildEnv('0234000001', 1);
    const r = await transactionsOrchestrator.process(env);
    expect(r.transaction.state).toBe('CONFIRMED');
    expect(r.transaction.response_code).toBe('ACSC');
    const history = await transactionsService.listHistory(r.transaction.id);
    expect(history.map((h) => h.to_state)).toEqual([
      'RECEIVED',
      'AUTHORIZED',
      'ROUTED',
      'CREDIT_LEG_PENDING',
      'CONFIRMED'
    ]);
  });
});

describe('orchestrator — terminal failure paths', () => {
  it('AM04 (insufficient funds force account 9999000002) → REJECTED with INSUFFICIENT_FUNDS', async () => {
    await ensureBeneAccount('9999000002');
    const env = buildEnv('9999000002', 2);
    const r = await transactionsOrchestrator.process(env);
    expect(r.transaction.state).toBe('REJECTED');
    expect(r.transaction.reason_code).toBe('INSUFFICIENT_FUNDS');
  });

  it('AC04 (closed account 9999000003) → REJECTED with BENEFICIARY_ACCOUNT_CLOSED', async () => {
    await ensureBeneAccount('9999000003');
    const env = buildEnv('9999000003', 3);
    const r = await transactionsOrchestrator.process(env);
    expect(r.transaction.state).toBe('REJECTED');
    expect(r.transaction.reason_code).toBe('BENEFICIARY_ACCOUNT_CLOSED');
  });

  it('beneficiary account not in directory → REJECTED with BENEFICIARY_ACCOUNT_NOT_FOUND', async () => {
    const env = buildEnv('0234999999', 9);
    const r = await transactionsOrchestrator.process(env);
    expect(r.transaction.state).toBe('REJECTED');
    expect(r.transaction.reason_code).toBe('BENEFICIARY_ACCOUNT_NOT_FOUND');
  });

  it('frozen beneficiary account → REJECTED with BENEFICIARY_ACCOUNT_BLOCKED', async () => {
    await ensureBeneAccount('0234000050', 'frozen');
    const env = buildEnv('0234000050', 50);
    const r = await transactionsOrchestrator.process(env);
    expect(r.transaction.state).toBe('REJECTED');
    expect(r.transaction.reason_code).toBe('BENEFICIARY_ACCOUNT_BLOCKED');
  });
});

describe('orchestrator — ambiguous outcomes', () => {
  it('TIMEOUT account 9999000007 → PENDING_RECONCILIATION', async () => {
    await ensureBeneAccount('9999000007');
    const env = buildEnv('9999000007', 7);
    const r = await transactionsOrchestrator.process(env);
    expect(r.transaction.state).toBe('PENDING_RECONCILIATION');
    expect(['TIMEOUT', 'UNREACHABLE']).toContain(r.transaction.reason_code);
  });

  it('UNREACHABLE account 9999000010 → PENDING_RECONCILIATION', async () => {
    await ensureBeneAccount('9999000010');
    const env = buildEnv('9999000010', 10);
    const r = await transactionsOrchestrator.process(env);
    expect(r.transaction.state).toBe('PENDING_RECONCILIATION');
    expect(['UNREACHABLE', 'TIMEOUT']).toContain(r.transaction.reason_code);
  });
});

describe('orchestrator — idempotency', () => {
  it('re-running with the same envelope returns the same transaction (terminal short-circuit)', async () => {
    await ensureBeneAccount('0234000777');
    const env = buildEnv('0234000777', 777);
    const a = await transactionsOrchestrator.process(env);
    const b = await transactionsOrchestrator.process(env);
    expect(b.transaction.id).toBe(a.transaction.id);
    expect(b.deduped).toBe(true);
    expect(b.transaction.state).toBe('CONFIRMED');
  });
});
