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
import { transactionsOrchestrator } from '../../transactions/index.js';
import { fraudBaselineService, fraudBaselineWorker } from '../index.js';

const ORIG = 'BL_BANK_O';
const BENE = 'BL_BANK_B';
let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM account_baselines`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM ledger_accounts`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'bl-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'fraud.%'`);
  await query(`DELETE FROM fee_schedules`);
  await query(`DELETE FROM participants WHERE code IN ($1,$2)`, [ORIG, BENE]);
};

const onboardActive = async (code) => {
  await participantsService.create({ code, name: code, legalName: `${code} PLC`, type: 'BANK', countryCode: 'GH' });
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
    [code, JSON.stringify({
      credit_leg: `${base}/simulator/${code}/credit-leg`,
      status_check: `${base}/simulator/${code}/status-check`,
      reversal: `${base}/simulator/${code}/reversal`
    })]
  );
};

const buildEnv = (idx, amount = '15000') =>
  createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'REST',
    sourceMessageId: `bl-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `bl-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `bl-idem-${Date.now()}-${idx}-${Math.random()}`,
    originator: { participantCode: ORIG, accountId: '0123000001', accountType: 'BANK_ACCOUNT', name: 'Originator' },
    beneficiary: { participantCode: BENE, accountId: `02340000${String(idx % 10).padStart(2, '0')}`, accountType: 'BANK_ACCOUNT', name: 'Beneficiary' },
    amount: { value: amount, currency: 'GHS' }
  });

beforeAll(async () => {
  await cleanup();
  await onboardActive(ORIG);
  await onboardActive(BENE);
  await directoryService.register({ participantCode: ORIG, accountType: 'BANK_ACCOUNT', accountNumber: '0123000001', accountName: 'Originator', currency: 'GHS' });
  for (let i = 0; i < 10; i += 1) {
    await directoryService.register({
      participantCode: BENE,
      accountType: 'BANK_ACCOUNT',
      accountNumber: `0234000${String(i).padStart(3, '0')}`,
      accountName: `Beneficiary ${i}`,
      currency: 'GHS'
    });
  }
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
  await query(`DELETE FROM account_baselines`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM fee_schedules`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'bl-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'fraud.%'`);
});

describe('baseline — recompute', () => {
  it('produces percentiles and temporal pcts for a seeded run', async () => {
    // Seed 12 confirmed transactions with varying amounts.
    const amounts = ['10000', '12000', '15000', '15000', '18000', '20000', '20000', '25000', '30000', '40000', '60000', '100000'];
    for (let i = 0; i < amounts.length; i += 1) {
      await transactionsOrchestrator.process(buildEnv(i, amounts[i]));
    }
    const result = await fraudBaselineService.recompute({
      participantCode: ORIG,
      accountNumber: '0123000001',
      currency: 'GHS'
    });
    expect(result).toBeTruthy();
    expect(result.total_observations).toBe(amounts.length);
    expect(BigInt(result.median_minor)).toBeGreaterThan(0n);
    expect(BigInt(result.max_observed_minor)).toBe(100000n);
    // Temporal percentages sum to whatever the buckets produce; just
    // assert each is in [0,100].
    expect(result.business_hours_pct).toBeGreaterThanOrEqual(0);
    expect(result.business_hours_pct).toBeLessThanOrEqual(100);
    expect(result.distinct_beneficiaries).toBeGreaterThan(0);
  });

  it('marks young accounts with the young marker in metadata', async () => {
    // Originator account was just registered in beforeAll, so it's < 30 days.
    await transactionsOrchestrator.process(buildEnv(0));
    const result = await fraudBaselineService.recompute({
      participantCode: ORIG,
      accountNumber: '0123000001',
      currency: 'GHS'
    });
    expect(result.metadata.marker).toBe('young');
    expect(result.metadata.young).toBe(true);
  });

  it('upsert is idempotent — second recompute updates the same row', async () => {
    await transactionsOrchestrator.process(buildEnv(1));
    const a = await fraudBaselineService.recompute({
      participantCode: ORIG,
      accountNumber: '0123000001',
      currency: 'GHS'
    });
    const b = await fraudBaselineService.recompute({
      participantCode: ORIG,
      accountNumber: '0123000001',
      currency: 'GHS'
    });
    expect(a.id).toBe(b.id);
  });
});

describe('baseline — worker', () => {
  it('refreshes baselines for stale accounts only', async () => {
    await transactionsOrchestrator.process(buildEnv(0));
    const r = await fraudBaselineWorker.runOnce();
    expect(r.scanned).toBeGreaterThanOrEqual(1);
    expect(r.refreshed).toBeGreaterThanOrEqual(1);
  });

  it('re-running the worker is idempotent', async () => {
    await transactionsOrchestrator.process(buildEnv(0));
    const a = await fraudBaselineWorker.runOnce();
    const b = await fraudBaselineWorker.runOnce();
    expect(b.scanned).toBe(a.scanned);
  });
});

describe('baseline — context wiring', () => {
  it('the rule context builder picks up the baseline after recompute', async () => {
    await transactionsOrchestrator.process(buildEnv(0));
    await fraudBaselineService.recompute({
      participantCode: ORIG,
      accountNumber: '0123000001',
      currency: 'GHS'
    });
    const { fraudRuleContextBuilder, transactionsService } = await Promise.all([
      import('../index.js'),
      import('../../transactions/index.js')
    ]).then(([f, t]) => ({ ...f, ...t }));
    const tx = await transactionsService.findByEndToEndId(`bl-e2e-${Date.now()}-0`).catch(() => null) || (await query(`SELECT * FROM transactions ORDER BY created_at DESC LIMIT 1`)).rows[0];
    const ctx = await fraudRuleContextBuilder.buildContext({ transaction: tx });
    expect(ctx.originator.baseline).toBeTruthy();
    expect(ctx.originator.baseline.total_observations).toBeGreaterThanOrEqual(1);
  });
});
