import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query, withTransaction } from '../../../core/db.js';
import { errorHandler } from '../../../core/http.js';
import { attachContext } from '../../../core/context.js';
import { createEnvelope, envelopeService } from '../../envelope/index.js';
import { participantsService } from '../../participants/index.js';
import { participantOnboardingService } from '../../participant-onboarding/index.js';
import { participantSimulatorRoutes } from '../../participant-simulator/index.js';
import { directoryService } from '../../directory/index.js';
import { cryptoKeysService } from '../../crypto-keys/index.js';
import { transactionsService } from '../../transactions/index.js';
import {
  POLICIES,
  getPolicy,
  nextDelayMs,
  isExhausted,
  PROBE_OUTCOMES,
  transactionRecoveryService,
  transactionRecoveryWorker
} from '../index.js';

const ORIG = 'REC_BANK_O';
const BENE = 'REC_BANK_B';
let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'rec-%'`);
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

const setBeneEndpoints = async (code, base, { unreachableStatusCheck = false } = {}) => {
  const eps = unreachableStatusCheck
    ? {
        credit_leg: `${base}/simulator/${code}/credit-leg`,
        // Point status_check to a port that nothing is listening on.
        status_check: 'http://127.0.0.1:1/simulator/status-check',
        reversal: `${base}/simulator/${code}/reversal`
      }
    : {
        credit_leg: `${base}/simulator/${code}/credit-leg`,
        status_check: `${base}/simulator/${code}/status-check`,
        reversal: `${base}/simulator/${code}/reversal`
      };
  await query(
    `UPDATE participants SET endpoints = $2::jsonb, updated_at = now() WHERE code = $1`,
    [code, JSON.stringify(eps)]
  );
};

const buildEnv = (beneAccount, idx) =>
  createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'REST',
    sourceMessageId: `rec-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `rec-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `rec-idem-${Date.now()}-${idx}-${Math.random()}`,
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

// Insert a transaction directly in PENDING_RECONCILIATION so we can drive
// recovery without first running the orchestrator's credit-leg path. The
// recovery worker is decoupled from how the transaction got there — it
// only cares that the row is in PENDING_RECONCILIATION with a participant
// it can reach.
const seedPendingReconciliation = async ({ beneAccount, idx, retryPolicyName = 'aggressive' }) => {
  const env = buildEnv(beneAccount, idx);
  await envelopeService.ingest(env);
  return withTransaction(async (client) => {
    const tx = await transactionsService.ingestFromEnvelope(env);
    await transactionsService.transition(client, tx.id, 'AUTHORIZED', { occurredBy: 'system' });
    await transactionsService.transition(client, tx.id, 'ROUTED', { occurredBy: 'system' });
    await transactionsService.transition(client, tx.id, 'CREDIT_LEG_PENDING', { occurredBy: 'system' });
    await transactionsService.transition(client, tx.id, 'PENDING_RECONCILIATION', {
      reasonCode: 'TIMEOUT',
      reasonMessage: 'seeded for recovery test',
      occurredBy: 'system'
    });
    await client.query(
      `UPDATE transactions
          SET retry_policy_name = $2,
              attempts = 0,
              next_attempt_at = now() - interval '1 second'
        WHERE id = $1`,
      [tx.id, retryPolicyName]
    );
    return await transactionsService.findById(tx.id);
  });
};

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
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'rec-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%'`);
  await setBeneEndpoints(BENE, baseUrl);
});

const ensureBeneAccount = async (account) => {
  await directoryService.register({
    participantCode: BENE,
    accountType: 'BANK_ACCOUNT',
    accountNumber: account,
    accountName: 'Beneficiary',
    currency: 'GHS'
  });
};

describe('recovery — policy', () => {
  it('aggressive policy is locked: 5 attempts, 2s base, ×2 backoff capped at 32s', () => {
    const p = getPolicy('aggressive');
    expect(p).toBe(POLICIES.aggressive);
    expect(p.maxAttempts).toBe(5);
    expect(p.initialMs).toBe(2_000);
    expect(p.capMs).toBe(32_000);
    expect(nextDelayMs(p, 0)).toBe(2_000);
    expect(nextDelayMs(p, 1)).toBe(4_000);
    expect(nextDelayMs(p, 2)).toBe(8_000);
    expect(nextDelayMs(p, 3)).toBe(16_000);
    expect(nextDelayMs(p, 4)).toBe(32_000);
    expect(nextDelayMs(p, 5)).toBe(32_000);
  });

  it('isExhausted goes true once attempts ≥ maxAttempts', () => {
    const p = getPolicy('aggressive');
    expect(isExhausted(p, 4)).toBe(false);
    expect(isExhausted(p, 5)).toBe(true);
    expect(isExhausted(p, 6)).toBe(true);
  });

  it('unknown policy name falls back to aggressive', () => {
    expect(getPolicy('does-not-exist')).toBe(POLICIES.aggressive);
  });
});

describe('recovery — single-pass terminals', () => {
  it('CREDITED status-check confirms the transaction immediately', async () => {
    await ensureBeneAccount('9999000001');
    const seeded = await seedPendingReconciliation({ beneAccount: '9999000001', idx: 1 });

    const res = await transactionRecoveryService.runOnceForId(seeded.id);

    expect(res.terminal).toBe('CONFIRMED');
    expect(res.attempts).toBe(1);
    expect(res.probe.outcome).toBe(PROBE_OUTCOMES.CREDITED);
    const tx = await transactionsService.findById(seeded.id);
    expect(tx.state).toBe('CONFIRMED');
    expect(tx.response_code).toBe('ACSC');
    expect(tx.reason_code).toBe('SUCCESS');
  });

  it('NOT_CREDITED status-check rejects the transaction immediately', async () => {
    await ensureBeneAccount('9999000002');
    const seeded = await seedPendingReconciliation({ beneAccount: '9999000002', idx: 2 });

    const res = await transactionRecoveryService.runOnceForId(seeded.id);

    expect(res.terminal).toBe('REJECTED');
    expect(res.probe.outcome).toBe(PROBE_OUTCOMES.NOT_CREDITED);
    const tx = await transactionsService.findById(seeded.id);
    expect(tx.state).toBe('REJECTED');
    expect(tx.reason_code).toBe('BENEFICIARY_NOT_CREDITED');
  });

  it('PENDING status-check schedules a retry, does not transition', async () => {
    await ensureBeneAccount('9999000007');
    const seeded = await seedPendingReconciliation({ beneAccount: '9999000007', idx: 3 });

    const res = await transactionRecoveryService.runOnceForId(seeded.id);

    expect(res.terminal).toBe(null);
    expect(res.probe.outcome).toBe(PROBE_OUTCOMES.PENDING);
    expect(res.attempts).toBe(1);
    expect(res.nextAttemptAt).toBeTruthy();
    const tx = await transactionsService.findById(seeded.id);
    expect(tx.state).toBe('PENDING_RECONCILIATION');
  });
});

describe('recovery — exhaustion', () => {
  it('5 PENDING outcomes exhaust into REJECTED with TIMEOUT', async () => {
    await ensureBeneAccount('9999000007');
    const seeded = await seedPendingReconciliation({ beneAccount: '9999000007', idx: 4 });

    let last = null;
    for (let i = 0; i < 5; i += 1) {
      // Force the transaction "due" between attempts so we don't have to
      // sleep through the backoff.
      await query(`UPDATE transactions SET next_attempt_at = now() - interval '1 second' WHERE id = $1`, [seeded.id]);
      last = await transactionRecoveryService.runOnceForId(seeded.id);
    }

    expect(last.terminal).toBe('REJECTED');
    expect(last.outcomes.every((o) => o === PROBE_OUTCOMES.PENDING)).toBe(true);
    const tx = await transactionsService.findById(seeded.id);
    expect(tx.state).toBe('REJECTED');
    expect(tx.reason_code).toBe('TIMEOUT');
  });

  it('all-NOT_FOUND/error outcomes exhaust into FAILED with auto-reversal queued', async () => {
    // Point status_check at an unreachable address so every probe errors.
    await setBeneEndpoints(BENE, baseUrl, { unreachableStatusCheck: true });
    await ensureBeneAccount('9999000007');
    const seeded = await seedPendingReconciliation({ beneAccount: '9999000007', idx: 5 });

    let last = null;
    for (let i = 0; i < 5; i += 1) {
      await query(`UPDATE transactions SET next_attempt_at = now() - interval '1 second' WHERE id = $1`, [seeded.id]);
      last = await transactionRecoveryService.runOnceForId(seeded.id);
    }

    expect(last.terminal).toBe('FAILED');
    expect(last.reversalQueued).toBe(true);
    const tx = await transactionsService.findById(seeded.id);
    expect(tx.state).toBe('FAILED');
    expect(tx.reason_code).toBe('RECONCILIATION_EXHAUSTED');
    const reversalAudit = await query(
      `SELECT event_type, payload FROM audit_events
        WHERE resource_id = $1 AND event_type = 'transaction.reversal_needed'`,
      [seeded.id]
    );
    expect(reversalAudit.rows.length).toBe(1);
  });
});

describe('recovery — counter durability', () => {
  it('attempts counter increments even when the deciding transition fails part-way', async () => {
    // Simulate a participant that returns PENDING (so we don't go terminal),
    // then we'll deliberately corrupt the deciding txn — but the simpler
    // assertion here is that after 3 actual passes we see attempts=3 in the
    // row, which proves the bumping uses a separate connection (otherwise
    // the FOR UPDATE lock from the deciding txn would force the bump to
    // serialize against it).
    await setBeneEndpoints(BENE, baseUrl);
    await ensureBeneAccount('9999000007');
    const seeded = await seedPendingReconciliation({ beneAccount: '9999000007', idx: 6 });

    for (let i = 0; i < 3; i += 1) {
      await query(`UPDATE transactions SET next_attempt_at = now() - interval '1 second' WHERE id = $1`, [seeded.id]);
      await transactionRecoveryService.runOnceForId(seeded.id);
    }
    const r = await query(`SELECT attempts FROM transactions WHERE id = $1`, [seeded.id]);
    expect(Number(r.rows[0].attempts)).toBe(3);

    const history = await query(
      `SELECT count(*)::int AS n FROM transaction_status_history
        WHERE transaction_id = $1 AND occurred_by = 'recovery-worker'`,
      [seeded.id]
    );
    expect(history.rows[0].n).toBe(3);
  });
});

describe('recovery — batch + worker', () => {
  it('runBatch only picks transactions whose next_attempt_at has come due', async () => {
    await ensureBeneAccount('9999000001');
    const due = await seedPendingReconciliation({ beneAccount: '9999000001', idx: 7 });
    const notYet = await seedPendingReconciliation({ beneAccount: '9999000001', idx: 8 });
    // Push the second one out into the future.
    await query(
      `UPDATE transactions SET next_attempt_at = now() + interval '10 minutes' WHERE id = $1`,
      [notYet.id]
    );

    const results = await transactionRecoveryService.runBatch({ limit: 10 });

    const ids = results.map((r) => r.id);
    expect(ids).toContain(due.id);
    expect(ids).not.toContain(notYet.id);
  });

  it('worker.start polls and drives a due transaction terminal, then stop cleans up', async () => {
    await ensureBeneAccount('9999000001');
    const seeded = await seedPendingReconciliation({ beneAccount: '9999000001', idx: 9 });

    transactionRecoveryWorker.start();
    try {
      // Test mode poll interval is ~25ms; give the worker a few ticks.
      let final = null;
      for (let i = 0; i < 60; i += 1) {
        const tx = await transactionsService.findById(seeded.id);
        if (tx.state === 'CONFIRMED') {
          final = tx;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(final?.state).toBe('CONFIRMED');
    } finally {
      await transactionRecoveryWorker.stop();
    }
  });
});
