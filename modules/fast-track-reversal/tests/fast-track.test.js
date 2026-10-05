import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { errorHandler } from '../../../core/http.js';
import { attachContext } from '../../../core/context.js';
import { createEnvelope } from '../../envelope/index.js';
import { participantsService } from '../../participants/index.js';
import { participantOnboardingService } from '../../participant-onboarding/index.js';
import { participantSimulatorRoutes, participantSimulatorService } from '../../participant-simulator/index.js';
import { directoryService } from '../../directory/index.js';
import { cryptoKeysService } from '../../crypto-keys/index.js';
import { transactionsOrchestrator, transactionsService } from '../../transactions/index.js';
import { fastTrackReversalService } from '../index.js';
import { uuidv7 } from '../../../core/uuid.js';

const ORIG = 'FTR_BANK_O';
const BENE = 'FTR_BANK_B';
let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM fast_track_reversals`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'ftr-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'fast_track.%'`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
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

const setBeneEndpoints = async (code, base, { freezeUrl } = {}) => {
  await query(
    `UPDATE participants SET endpoints = $2::jsonb, updated_at = now() WHERE code = $1`,
    [
      code,
      JSON.stringify({
        credit_leg: `${base}/simulator/${code}/credit-leg`,
        status_check: `${base}/simulator/${code}/status-check`,
        reversal: `${base}/simulator/${code}/reversal`,
        freeze: freezeUrl ?? `${base}/simulator/${code}/freeze`
      })
    ]
  );
};

const buildEnv = (beneAccount, idx) =>
  createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'REST',
    sourceMessageId: `ftr-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `ftr-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `ftr-idem-${Date.now()}-${idx}-${Math.random()}`,
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

const ensureBeneAccount = async (account) => {
  await directoryService.register({
    participantCode: BENE,
    accountType: 'BANK_ACCOUNT',
    accountNumber: account,
    accountName: 'Beneficiary',
    currency: 'GHS'
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
  await query(`DELETE FROM fast_track_reversals`);
  await query(`DELETE FROM accounts WHERE participant_code = $1 AND account_number LIKE '02%'`, [BENE]);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'ftr-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'fast_track.%'`);
  await setBeneEndpoints(BENE, baseUrl);
});

const confirmTx = async (idx, beneAccount = '0234000001') => {
  await ensureBeneAccount(beneAccount);
  const env = buildEnv(beneAccount, idx);
  const r = await transactionsOrchestrator.process(env);
  if (r.transaction.state !== 'CONFIRMED') {
    throw new Error(`expected CONFIRMED, got ${r.transaction.state}`);
  }
  return r.transaction;
};

const evidence = (note = 'unauthorized debit reported') => ({
  source: 'customer_complaint',
  note,
  filedAt: new Date().toISOString()
});

describe('fast-track-reversal — invoke happy path', () => {
  it('freezes the receiving account and persists the FTR in frozen state', async () => {
    const original = await confirmTx(1);
    const { ftr, freezeResult } = await fastTrackReversalService.invoke({
      originalTransactionId: original.id,
      evidence: evidence(),
      reasonCode: 'FRAD',
      reasonMessage: 'reported within minutes of credit',
      invokedBy: null,
      victimParticipant: ORIG
    });
    expect(freezeResult.ok).toBe(true);
    expect(ftr.state).toBe('frozen');
    expect(ftr.victim_participant).toBe(ORIG);
    expect(ftr.receiving_participant).toBe(BENE);
    expect(ftr.freeze_attempted_at).toBeTruthy();
    expect(ftr.receiving_acknowledged_at).toBeTruthy();
    // confirmReversal hasn't run yet — original should still be CONFIRMED.
    const stillOriginal = await transactionsService.findById(original.id);
    expect(stillOriginal.state).toBe('CONFIRMED');
  });

  it('writes both fast_track.invoked and fast_track.frozen audit events', async () => {
    const original = await confirmTx(2);
    const { ftr } = await fastTrackReversalService.invoke({
      originalTransactionId: original.id,
      evidence: evidence(),
      reasonCode: 'FRAD',
      invokedBy: null,
      victimParticipant: ORIG
    });
    const audit = await query(
      `SELECT event_type FROM audit_events WHERE resource_id = $1 ORDER BY ts ASC`,
      [ftr.id]
    );
    const types = audit.rows.map((r) => r.event_type);
    expect(types).toContain('fast_track.invoked');
    expect(types).toContain('fast_track.frozen');
  });
});

describe('fast-track-reversal — confirmReversal', () => {
  it('hands off to reversalsService.initiate and unwinds the original to REVERSED', async () => {
    const original = await confirmTx(3);
    const { ftr } = await fastTrackReversalService.invoke({
      originalTransactionId: original.id,
      evidence: evidence(),
      reasonCode: 'FRAD',
      invokedBy: null,
      victimParticipant: ORIG
    });
    expect(ftr.state).toBe('frozen');

    const { ftr: completed, reversal } = await fastTrackReversalService.confirmReversal({
      id: ftr.id,
      confirmedBy: null
    });
    expect(completed.state).toBe('completed');
    expect(completed.reversal_transaction_id).toBe(reversal.reversal.id);
    expect(completed.resolved_at).toBeTruthy();

    const stillOriginal = await transactionsService.findById(original.id);
    expect(stillOriginal.state).toBe('REVERSED');
    expect(stillOriginal.reason_code).toBe('FRAD');
  });

  it('rejects confirmReversal when the FTR is not in frozen state', async () => {
    const original = await confirmTx(4);
    const { ftr } = await fastTrackReversalService.invoke({
      originalTransactionId: original.id,
      evidence: evidence(),
      reasonCode: 'FRAD',
      invokedBy: null,
      victimParticipant: ORIG
    });
    // First confirm transitions to completed.
    await fastTrackReversalService.confirmReversal({ id: ftr.id, confirmedBy: null });
    // Second confirm should fail because state is now completed.
    await expect(
      fastTrackReversalService.confirmReversal({ id: ftr.id, confirmedBy: null })
    ).rejects.toThrow(/only 'frozen' is reversible/);
  });
});

describe('fast-track-reversal — invoke validation', () => {
  it('rejects a non-CONFIRMED original', async () => {
    await ensureBeneAccount('9999000002'); // AM04 — REJECTED
    const env = buildEnv('9999000002', 5);
    const r = await transactionsOrchestrator.process(env);
    expect(r.transaction.state).toBe('REJECTED');

    await expect(
      fastTrackReversalService.invoke({
        originalTransactionId: r.transaction.id,
        evidence: evidence(),
        reasonCode: 'FRAD',
        invokedBy: null,
        victimParticipant: ORIG
      })
    ).rejects.toThrow(/CONFIRMED/);
  });

  it('rejects when the original is older than the configured window', async () => {
    const original = await confirmTx(6);
    // Backdate confirmed_at to 200 days ago.
    await query(
      `UPDATE transactions SET confirmed_at = now() - interval '200 days' WHERE id = $1`,
      [original.id]
    );
    await expect(
      fastTrackReversalService.invoke({
        originalTransactionId: original.id,
        evidence: evidence(),
        reasonCode: 'FRAD',
        invokedBy: null,
        victimParticipant: ORIG
      })
    ).rejects.toThrow(/older than/);
  });

  it('rejects when victimParticipant is not the original originator', async () => {
    const original = await confirmTx(7);
    await expect(
      fastTrackReversalService.invoke({
        originalTransactionId: original.id,
        evidence: evidence(),
        reasonCode: 'FRAD',
        invokedBy: null,
        victimParticipant: BENE
      })
    ).rejects.toThrow(/originator participant/);
  });

  it('returns 404 for an unknown transaction id', async () => {
    await expect(
      fastTrackReversalService.invoke({
        originalTransactionId: uuidv7(),
        evidence: evidence(),
        reasonCode: 'FRAD',
        invokedBy: null,
        victimParticipant: ORIG
      })
    ).rejects.toThrow(/not found/);
  });
});

describe('fast-track-reversal — receiving rejects the freeze', () => {
  it('persists the FTR in rejected state when the receiving participant returns AC04', async () => {
    // The credit-leg uses a normal account (succeeds). Then we install a
    // per-participant override so that the simulator's freeze handler
    // rejects with AC04 for that account.
    const original = await confirmTx(8, '0234000050');
    await participantSimulatorService.upsertOverride({
      participantCode: BENE,
      accountNumber: '0234000050',
      behavior: 'REJECT_AC04',
      reasonCode: 'BENEFICIARY_ACCOUNT_CLOSED',
      delayMs: 5
    });
    const { ftr, freezeResult } = await fastTrackReversalService.invoke({
      originalTransactionId: original.id,
      evidence: evidence(),
      reasonCode: 'FRAD',
      invokedBy: null,
      victimParticipant: ORIG
    });
    expect(freezeResult.ok).toBe(false);
    expect(ftr.state).toBe('rejected');
    expect(ftr.reason_message).toMatch(/Closed Account/i);
    await query(`DELETE FROM simulator_overrides WHERE account_number = $1`, ['0234000050']);
  });
});

describe('fast-track-reversal — receiving times out', () => {
  it('persists the FTR in expired state when the freeze call times out', async () => {
    const original = await confirmTx(9, '0234000060');
    await participantSimulatorService.upsertOverride({
      participantCode: BENE,
      accountNumber: '0234000060',
      behavior: 'TIMEOUT',
      delayMs: 5
    });
    const { ftr, freezeResult } = await fastTrackReversalService.invoke({
      originalTransactionId: original.id,
      evidence: evidence(),
      reasonCode: 'FRAD',
      invokedBy: null,
      victimParticipant: ORIG
    });
    expect(freezeResult.ok).toBe(false);
    expect(['expired', 'rejected']).toContain(ftr.state);
    await query(`DELETE FROM simulator_overrides WHERE account_number = $1`, ['0234000060']);
  }, 15000);
});

describe('fast-track-reversal — monthly quota', () => {
  it('rejects the (quota+1)th invocation in the same month', async () => {
    // Test config sets FAST_TRACK_INVOKE_MONTHLY_QUOTA=3 — so the 4th invoke
    // for the same victim participant must fail with a quota error.
    for (let i = 0; i < 3; i++) {
      const original = await confirmTx(100 + i, `0234000${i + 1}`);
      const { ftr } = await fastTrackReversalService.invoke({
        originalTransactionId: original.id,
        evidence: evidence(),
        reasonCode: 'FRAD',
        invokedBy: null,
        victimParticipant: ORIG
      });
      expect(ftr.state).toBe('frozen');
    }
    const fourth = await confirmTx(200, '0234000099');
    await expect(
      fastTrackReversalService.invoke({
        originalTransactionId: fourth.id,
        evidence: evidence(),
        reasonCode: 'FRAD',
        invokedBy: null,
        victimParticipant: ORIG
      })
    ).rejects.toThrow(/monthly fast-track quota/);
  });
});

describe('fast-track-reversal — list/findById', () => {
  it('list filters by state and victimParticipant', async () => {
    const t1 = await confirmTx(11);
    await fastTrackReversalService.invoke({
      originalTransactionId: t1.id,
      evidence: evidence(),
      reasonCode: 'FRAD',
      invokedBy: null,
      victimParticipant: ORIG
    });
    const all = await fastTrackReversalService.list({});
    expect(all.length).toBeGreaterThanOrEqual(1);
    const onlyFrozen = await fastTrackReversalService.list({ state: 'frozen' });
    expect(onlyFrozen.every((r) => r.state === 'frozen')).toBe(true);
    const byVictim = await fastTrackReversalService.list({ victimParticipant: ORIG });
    expect(byVictim.every((r) => r.victim_participant === ORIG)).toBe(true);
  });
});
