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
import { transactionsOrchestrator, transactionsService } from '../../transactions/index.js';
import { ledgerService } from '../../ledger/index.js';
import { feesService, calculateFromSchedule } from '../index.js';

const ORIG = 'FEE_O_BNK';
const BENE = 'FEE_B_BNK';
let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM ledger_accounts`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM fee_schedules`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'fee-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'fees.%'`);
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
    sourceMessageId: `fee-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `fee-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `fee-idem-${Date.now()}-${idx}-${Math.random()}`,
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
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM fee_schedules`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'fee-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'fees.%'`);
});

describe('fees — calculator (pure)', () => {
  it('FLAT applies the flat amount, clamped by min/max', () => {
    const { feeMinor } = calculateFromSchedule(
      { fee_type: 'FLAT', flat_minor: '50', min_fee_minor: '0', max_fee_minor: null },
      '15000'
    );
    expect(feeMinor.toString()).toBe('50');
  });

  it('PERCENTAGE applies pct in basis points with min/max clamps', () => {
    const r = calculateFromSchedule(
      { fee_type: 'PERCENTAGE', pct_bps: 25, min_fee_minor: '50', max_fee_minor: '5000' },
      '100000'
    );
    expect(r.feeMinor.toString()).toBe('250');
    const minClamped = calculateFromSchedule(
      { fee_type: 'PERCENTAGE', pct_bps: 25, min_fee_minor: '500', max_fee_minor: '5000' },
      '1000'
    );
    expect(minClamped.feeMinor.toString()).toBe('500');
    const maxClamped = calculateFromSchedule(
      { fee_type: 'PERCENTAGE', pct_bps: 25, min_fee_minor: '0', max_fee_minor: '100' },
      '100000'
    );
    expect(maxClamped.feeMinor.toString()).toBe('100');
  });

  it('TIERED selects the tier that matches the amount', () => {
    const tiers = [
      { fromMinor: '0', toMinor: '999', feeMinor: '10' },
      { fromMinor: '1000', toMinor: '9999', feeMinor: '50' },
      { fromMinor: '10000', toMinor: null, feeBps: 30 }
    ];
    const a = calculateFromSchedule(
      { fee_type: 'TIERED', tiers, min_fee_minor: '0', max_fee_minor: null },
      '500'
    );
    expect(a.feeMinor.toString()).toBe('10');
    const b = calculateFromSchedule(
      { fee_type: 'TIERED', tiers, min_fee_minor: '0', max_fee_minor: null },
      '5000'
    );
    expect(b.feeMinor.toString()).toBe('50');
    const c = calculateFromSchedule(
      { fee_type: 'TIERED', tiers, min_fee_minor: '0', max_fee_minor: null },
      '50000'
    );
    expect(c.feeMinor.toString()).toBe('150'); // 50000 * 30bps = 150
  });
});

describe('fees — schedule rollover atomicity', () => {
  it('publishing a new schedule expires the previous active one', async () => {
    await feesService.publishSchedule({
      scheduleCode: 'fee-test-1',
      railClass: 'DOMESTIC_INSTANT',
      currency: 'GHS',
      feeType: 'FLAT',
      flatMinor: '50'
    });
    const after = await feesService.publishSchedule({
      scheduleCode: 'fee-test-2',
      railClass: 'DOMESTIC_INSTANT',
      currency: 'GHS',
      feeType: 'FLAT',
      flatMinor: '75'
    });
    const list = await feesService.listSchedules({ railClass: 'DOMESTIC_INSTANT', currency: 'GHS' });
    const active = list.filter((s) => s.active === true);
    expect(active.length).toBe(1);
    expect(active[0].id).toBe(after.id);
  });
});

describe('fees — orchestrator integration', () => {
  it('orchestrator stamps fee_minor and emits a 3-leg journal', async () => {
    await feesService.publishSchedule({
      scheduleCode: 'fee-orc-flat',
      railClass: 'DOMESTIC_INSTANT',
      currency: 'GHS',
      feeType: 'FLAT',
      flatMinor: '50'
    });
    const r = await transactionsOrchestrator.process(buildEnv(1, '15000'));
    expect(r.transaction.state).toBe('CONFIRMED');
    const fresh = await transactionsService.findById(r.transaction.id);
    expect(String(fresh.fee_minor)).toBe('50');
    expect(fresh.fee_schedule_id).toBeTruthy();

    const [journal] = await ledgerService.journalsByReference('transaction', r.transaction.id);
    const detail = await ledgerService.journalById(journal.id);
    expect(detail.postings.length).toBe(3);
    const dr = detail.postings.find((p) => p.side === 'DR');
    expect(String(dr.amount_value)).toBe('15050'); // amount + fee
    const fee = detail.postings.find((p) => p.account_code === 'RAIL_FEE_REVENUE:GHS');
    expect(String(fee.amount_value)).toBe('50');
  });

  it('zero-fee schedule (no schedule active) keeps the journal at 2 legs', async () => {
    const r = await transactionsOrchestrator.process(buildEnv(2, '15000'));
    expect(r.transaction.state).toBe('CONFIRMED');
    const fresh = await transactionsService.findById(r.transaction.id);
    expect(String(fresh.fee_minor)).toBe('0');
    const [journal] = await ledgerService.journalsByReference('transaction', r.transaction.id);
    const detail = await ledgerService.journalById(journal.id);
    expect(detail.postings.length).toBe(2);
  });
});

describe('fees — calculate endpoint', () => {
  it('returns the active schedule fee for a given amount', async () => {
    await feesService.publishSchedule({
      scheduleCode: 'fee-calc-pct',
      railClass: 'MOBILE_MONEY_INTEROP',
      currency: 'GHS',
      feeType: 'PERCENTAGE',
      pctBps: 25,
      minFeeMinor: '50',
      maxFeeMinor: '5000'
    });
    const r = await feesService.calculateFee({
      railClass: 'MOBILE_MONEY_INTEROP',
      currency: 'GHS',
      amountMinor: '100000'
    });
    expect(r.feeMinor).toBe('250');
  });
});
