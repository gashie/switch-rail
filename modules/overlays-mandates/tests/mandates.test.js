import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { errorHandler } from '../../../core/http.js';
import { attachContext } from '../../../core/context.js';
import { participantsService } from '../../participants/index.js';
import { participantOnboardingService } from '../../participant-onboarding/index.js';
import { participantSimulatorRoutes } from '../../participant-simulator/index.js';
import { directoryService } from '../../directory/index.js';
import { cryptoKeysService } from '../../crypto-keys/index.js';
import { overlaysMandatesService, mandatesSchedulerWorker, STATES } from '../index.js';

const PAYER = 'MND_PAYER';
const PAYEE = 'MND_PAYEE';
let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM mandate_debits`);
  await query(`DELETE FROM mandates`);
  await query(`DELETE FROM mandate_sequence`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [PAYER, PAYEE]);
  await query(`DELETE FROM ledger_accounts`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'mnd-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [PAYER, PAYEE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [PAYER, PAYEE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [PAYER, PAYEE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [PAYER, PAYEE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'mandate.%' OR event_type LIKE 'ledger.%'`);
  await query(`DELETE FROM fee_schedules`);
  await query(`DELETE FROM participants WHERE code IN ($1,$2)`, [PAYER, PAYEE]);
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

const setEndpoints = async (code, base) => {
  await query(
    `UPDATE participants SET endpoints = $2::jsonb, updated_at = now() WHERE code = $1`,
    [code, JSON.stringify({
      credit_leg: `${base}/simulator/${code}/credit-leg`,
      status_check: `${base}/simulator/${code}/status-check`,
      reversal: `${base}/simulator/${code}/reversal`,
      freeze: `${base}/simulator/${code}/freeze`
    })]
  );
};

beforeAll(async () => {
  await cleanup();
  await onboardActive(PAYER);
  await onboardActive(PAYEE);
  await directoryService.register({ participantCode: PAYER, accountType: 'BANK_ACCOUNT', accountNumber: '0PR0000001', accountName: 'Payer acct', currency: 'GHS' });
  await directoryService.register({ participantCode: PAYEE, accountType: 'BANK_ACCOUNT', accountNumber: '0PE0000001', accountName: 'Payee acct', currency: 'GHS' });
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
  await setEndpoints(PAYER, baseUrl);
  await setEndpoints(PAYEE, baseUrl);
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await cleanup();
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM mandate_debits`);
  await query(`DELETE FROM mandates`);
  await query(`DELETE FROM mandate_sequence`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'mnd-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'mandate.%' OR event_type LIKE 'ledger.%'`);
  await setEndpoints(PAYER, baseUrl);
  await setEndpoints(PAYEE, baseUrl);
});

const createMandate = (overrides = {}) =>
  overlaysMandatesService.create({
    payerParticipant: PAYER,
    payerAccountNumber: '0PR0000001',
    payeeParticipant: PAYEE,
    payeeAccountNumber: '0PE0000001',
    perDebitCapMinor: '5000',
    currency: 'GHS',
    frequency: 'AS_PRESENTED',
    reference: 'MOMO Sub',
    ...overrides
  });

describe('overlays-mandates — create', () => {
  it('creates an active AS_PRESENTED mandate', async () => {
    const m = await createMandate();
    expect(m.state).toBe(STATES.ACTIVE);
    expect(m.mandate_number).toMatch(/^MND-\d{6}-000001$/);
    expect(m.frequency).toBe('AS_PRESENTED');
    expect(m.next_scheduled_at).toBeNull();
  });

  it('time-based mandate sets next_scheduled_at', async () => {
    const m = await createMandate({ frequency: 'DAILY' });
    expect(m.next_scheduled_at).toBeTruthy();
  });
});

describe('overlays-mandates — present debit (cap algorithm)', () => {
  it('successful debit produces CRDT_TRF and bumps total_debited', async () => {
    const m = await createMandate({ perDebitCapMinor: '5000' });
    const r = await overlaysMandatesService.presentDebit({
      mandateId: m.id,
      presentedAmountMinor: '3000'
    });
    expect(r.ok).toBe(true);
    expect(r.transaction.state).toBe('CONFIRMED');
    expect(String(r.mandate.total_debited_minor)).toBe('3000');
    expect(r.mandate.total_debit_count).toBe(1);
  });

  it('per-debit cap breach blocks debit', async () => {
    const m = await createMandate({ perDebitCapMinor: '1000' });
    const r = await overlaysMandatesService.presentDebit({
      mandateId: m.id,
      presentedAmountMinor: '5000'
    });
    expect(r.ok).toBe(false);
    expect(r.reason.result).toBe('CAP_BREACH');
    expect(String(r.mandate.total_debited_minor)).toBe('0');
  });

  it('daily cap breach blocks the second debit', async () => {
    const m = await createMandate({ perDebitCapMinor: '5000', dailyCapMinor: '5000' });
    const r1 = await overlaysMandatesService.presentDebit({ mandateId: m.id, presentedAmountMinor: '4000' });
    expect(r1.ok).toBe(true);
    const r2 = await overlaysMandatesService.presentDebit({ mandateId: m.id, presentedAmountMinor: '4000' });
    expect(r2.ok).toBe(false);
    expect(r2.reason.message).toMatch(/daily/);
  });

  it('total cap exhaustion transitions to EXHAUSTED', async () => {
    const m = await createMandate({ perDebitCapMinor: '1000', totalCapMinor: '2000' });
    await overlaysMandatesService.presentDebit({ mandateId: m.id, presentedAmountMinor: '1000' });
    const r2 = await overlaysMandatesService.presentDebit({ mandateId: m.id, presentedAmountMinor: '1000' });
    expect(r2.ok).toBe(true);
    expect(r2.mandate.state).toBe(STATES.EXHAUSTED);
    // Subsequent debit fails because mandate is terminal.
    const r3 = await overlaysMandatesService.presentDebit({ mandateId: m.id, presentedAmountMinor: '500' });
    expect(r3.ok).toBe(false);
  });
});

describe('overlays-mandates — revoke / pause / resume', () => {
  it('revoke is instant; subsequent debits fail', async () => {
    const m = await createMandate({ frequency: 'DAILY' });
    await overlaysMandatesService.revoke({
      mandateNumber: m.mandate_number,
      revokedBy: 'PAYER',
      reason: 'subscription cancelled'
    });
    const after = await overlaysMandatesService.findByNumber(m.mandate_number);
    expect(after.state).toBe(STATES.REVOKED);
    expect(after.next_scheduled_at).toBeNull();
    const r = await overlaysMandatesService.presentDebit({ mandateId: m.id, presentedAmountMinor: '500' });
    expect(r.ok).toBe(false);
  });

  it('pause blocks debits, resume restores them', async () => {
    const m = await createMandate({ perDebitCapMinor: '5000' });
    await overlaysMandatesService.pause({ mandateNumber: m.mandate_number });
    const r1 = await overlaysMandatesService.presentDebit({ mandateId: m.id, presentedAmountMinor: '500' });
    expect(r1.ok).toBe(false);
    expect(r1.reason.result).toBe('PAUSED');
    await overlaysMandatesService.resume({ mandateNumber: m.mandate_number });
    const r2 = await overlaysMandatesService.presentDebit({ mandateId: m.id, presentedAmountMinor: '500' });
    expect(r2.ok).toBe(true);
  });
});

describe('overlays-mandates — scheduler', () => {
  it('tick processes due time-based mandates', async () => {
    // Create a DAILY mandate and force its next_scheduled_at into the past.
    const m = await createMandate({ frequency: 'DAILY', perDebitCapMinor: '1000' });
    await query(
      `UPDATE mandates SET next_scheduled_at = now() - interval '1 hour', metadata = '{"scheduledAmountMinor": "500"}'::jsonb WHERE id = $1`,
      [m.id]
    );
    const out = await mandatesSchedulerWorker.runOnce();
    expect(out.processed).toBe(1);
    expect(out.results[0].ok).toBe(true);
    const after = await overlaysMandatesService.findByNumber(m.mandate_number);
    expect(String(after.total_debited_minor)).toBe('500');
    expect(after.total_debit_count).toBe(1);
    // next_scheduled_at advanced by ~1 day.
    expect(new Date(after.next_scheduled_at).getTime()).toBeGreaterThan(Date.now());
  });
});
