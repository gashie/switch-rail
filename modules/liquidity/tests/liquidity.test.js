import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { ledgerService } from '../../ledger/index.js';
import { settlementPositionsService } from '../../settlement/index.js';
import { liquidityService } from '../index.js';

const ORIG = 'LIQ_ORIG';
const BENE = 'LIQ_BENE';
let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM liquidity_topups WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM liquidity_limits WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM ledger_accounts WHERE owner_id IN ($1,$2) OR account_code = 'OPERATOR_RTGS_NOSTRO:GHS'`, [ORIG, BENE]);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'liq-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'liquidity.%'`);
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
    sourceMessageId: `liq-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `liq-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `liq-idem-${Date.now()}-${idx}-${Math.random()}`,
    originator: { participantCode: ORIG, accountId: '0123000001', accountType: 'BANK_ACCOUNT', name: 'Originator' },
    beneficiary: { participantCode: BENE, accountId: '0234000001', accountType: 'BANK_ACCOUNT', name: 'Beneficiary' },
    amount: { value: amount, currency: 'GHS' }
  });

beforeAll(async () => {
  await cleanup();
  await onboardActive(ORIG);
  await onboardActive(BENE);
  await directoryService.register({ participantCode: ORIG, accountType: 'BANK_ACCOUNT', accountNumber: '0123000001', accountName: 'Originator', currency: 'GHS' });
  await directoryService.register({ participantCode: BENE, accountType: 'BANK_ACCOUNT', accountNumber: '0234000001', accountName: 'Beneficiary', currency: 'GHS' });
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
  await query(`DELETE FROM liquidity_topups`);
  await query(`DELETE FROM liquidity_limits`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'liq-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'liquidity.%'`);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('liquidity — configureLimits', () => {
  it('upserts limits idempotently', async () => {
    const a = await liquidityService.configureLimits({
      participantCode: ORIG, currency: 'GHS',
      prefundedMinor: '1000000', floorMinor: '0', ceilingMinor: '500000', throttleThresholdPct: 80
    });
    const b = await liquidityService.configureLimits({
      participantCode: ORIG, currency: 'GHS',
      prefundedMinor: '2000000', floorMinor: '0', ceilingMinor: '1000000', throttleThresholdPct: 90
    });
    expect(a.id).toBe(b.id);
    expect(String(b.ceiling_minor)).toBe('1000000');
    expect(b.throttle_threshold_pct).toBe(90);
  });

  it('rejects invalid ceiling/floor combinations', async () => {
    await expect(
      liquidityService.configureLimits({
        participantCode: ORIG, currency: 'GHS',
        prefundedMinor: '0', floorMinor: '1000', ceilingMinor: '500'
      })
    ).rejects.toThrow(/floorMinor must be in/);
    await expect(
      liquidityService.configureLimits({
        participantCode: ORIG, currency: 'GHS',
        prefundedMinor: '0', floorMinor: '0', ceilingMinor: '0'
      })
    ).rejects.toThrow(/ceilingMinor must be positive/);
  });
});

describe('liquidity — applyTopUp posts a balanced journal', () => {
  it('credits participant settlement and debits OPERATOR_RTGS_NOSTRO', async () => {
    const r = await liquidityService.applyTopUp({
      participantCode: ORIG, currency: 'GHS',
      amountMinor: '500000', reason: 'phase-5 test top-up'
    });
    expect(r.journal.journalId).toBeTruthy();
    const detail = await ledgerService.journalById(r.journal.journalId);
    const dr = detail.postings.find((p) => p.side === 'DR');
    const cr = detail.postings.find((p) => p.side === 'CR');
    expect(dr.account_code).toBe('OPERATOR_RTGS_NOSTRO:GHS');
    expect(cr.account_code).toBe(`PSET:${ORIG}:GHS`);
    const pos = await settlementPositionsService.positionFor(ORIG, 'GHS');
    expect(pos.positionMinor).toBe('500000');
  });

  it('rejects non-positive top-up amounts', async () => {
    await expect(
      liquidityService.applyTopUp({ participantCode: ORIG, currency: 'GHS', amountMinor: '0', reason: 'bad' })
    ).rejects.toThrow(/positive/);
  });
});

describe('liquidity — canDebit', () => {
  it('passes with NOT_CONFIGURED when no limits set', async () => {
    const r = await liquidityService.canDebit({
      participantCode: ORIG, currency: 'GHS', amountMinor: '15000'
    });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('NOT_CONFIGURED');
  });

  it('passes when projected position is below throttle threshold', async () => {
    await liquidityService.configureLimits({
      participantCode: ORIG, currency: 'GHS',
      prefundedMinor: '0', floorMinor: '0', ceilingMinor: '100000', throttleThresholdPct: 80
    });
    // Position 0 + 50000 = 50000, threshold 80000 — below.
    const r = await liquidityService.canDebit({
      participantCode: ORIG, currency: 'GHS', amountMinor: '50000'
    });
    expect(r.ok).toBe(true);
  });

  it('blocks at or above the ceiling', async () => {
    await liquidityService.configureLimits({
      participantCode: ORIG, currency: 'GHS',
      prefundedMinor: '0', floorMinor: '0', ceilingMinor: '100000', throttleThresholdPct: 80
    });
    const r = await liquidityService.canDebit({
      participantCode: ORIG, currency: 'GHS', amountMinor: '150000'
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('INSUFFICIENT_LIQUIDITY');
  });

  it('throttles probabilistically between threshold and ceiling', async () => {
    await liquidityService.configureLimits({
      participantCode: ORIG, currency: 'GHS',
      prefundedMinor: '0', floorMinor: '0', ceilingMinor: '100000', throttleThresholdPct: 80
    });
    // Force the dice: at projected 90000, probability is (90000-80000)/(100000-80000) = 0.5
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // below 0.5 → throttled
    const blocked = await liquidityService.canDebit({
      participantCode: ORIG, currency: 'GHS', amountMinor: '90000'
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('THROTTLED');

    vi.spyOn(Math, 'random').mockReturnValue(0.9); // above 0.5 → pass
    const allowed = await liquidityService.canDebit({
      participantCode: ORIG, currency: 'GHS', amountMinor: '90000'
    });
    expect(allowed.ok).toBe(true);
  });
});

describe('liquidity — authorization patch', () => {
  it('orchestrator rejects with TRANSACTION_FORBIDDEN when participant is at ceiling', async () => {
    await liquidityService.configureLimits({
      participantCode: ORIG, currency: 'GHS',
      prefundedMinor: '0', floorMinor: '0', ceilingMinor: '10000', throttleThresholdPct: 80
    });
    // Tx amount 15000 > ceiling 10000 → INSUFFICIENT_LIQUIDITY
    const env = buildEnv(1, '15000');
    const r = await transactionsOrchestrator.process(env);
    expect(r.transaction.state).toBe('REJECTED');
    expect(r.transaction.reason_code).toBe('TRANSACTION_FORBIDDEN');
  });

  it('orchestrator allows transactions below threshold', async () => {
    await liquidityService.configureLimits({
      participantCode: ORIG, currency: 'GHS',
      prefundedMinor: '0', floorMinor: '0', ceilingMinor: '1000000', throttleThresholdPct: 80
    });
    const env = buildEnv(2, '15000');
    const r = await transactionsOrchestrator.process(env);
    expect(r.transaction.state).toBe('CONFIRMED');
  });
});

describe('liquidity — listings', () => {
  it('listLimits filters by currency', async () => {
    await liquidityService.configureLimits({
      participantCode: ORIG, currency: 'GHS',
      prefundedMinor: '0', floorMinor: '0', ceilingMinor: '100000'
    });
    const ghs = await liquidityService.listLimits({ currency: 'GHS' });
    expect(ghs.every((r) => r.currency === 'GHS')).toBe(true);
  });

  it('listTopups returns rows after applyTopUp', async () => {
    await liquidityService.applyTopUp({
      participantCode: ORIG, currency: 'GHS', amountMinor: '100', reason: 'list test'
    });
    const list = await liquidityService.listTopups({ participantCode: ORIG });
    expect(list.length).toBe(1);
    expect(String(list[0].amount_minor)).toBe('100');
  });
});
