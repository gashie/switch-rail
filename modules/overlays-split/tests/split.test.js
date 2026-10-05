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
import { overlaysSplitService, SPLIT_STATES } from '../index.js';

const PAYER = 'SPL_PAYER';
const B1 = 'SPL_B1';
const B2 = 'SPL_B2';
const B3 = 'SPL_B3';
const B4 = 'SPL_B4';
const PARTICIPANTS = [PAYER, B1, B2, B3, B4];
let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM split_legs`);
  await query(`DELETE FROM split_instructions`);
  await query(`DELETE FROM split_sequence`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions WHERE participant_code = ANY($1)`, [PARTICIPANTS]);
  await query(`DELETE FROM ledger_accounts`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'spl-%'`);
  await query(`DELETE FROM accounts WHERE participant_code = ANY($1)`, [PARTICIPANTS]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code = ANY($1))`, [PARTICIPANTS]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code = ANY($1))`, [PARTICIPANTS]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id = ANY($1)`, [PARTICIPANTS]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'split.%' OR event_type LIKE 'ledger.%'`);
  await query(`DELETE FROM fee_schedules`);
  await query(`DELETE FROM participants WHERE code = ANY($1)`, [PARTICIPANTS]);
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
  for (const c of PARTICIPANTS) await onboardActive(c);
  await directoryService.register({ participantCode: PAYER, accountType: 'BANK_ACCOUNT', accountNumber: '0SP0000001', accountName: 'Payer', currency: 'GHS' });
  for (const [c, acc] of [[B1, '0S10000001'], [B2, '0S20000001'], [B3, '0S30000001'], [B4, '0S40000001']]) {
    await directoryService.register({ participantCode: c, accountType: 'BANK_ACCOUNT', accountNumber: acc, accountName: `${c} acct`, currency: 'GHS' });
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
  for (const c of PARTICIPANTS) await setEndpoints(c, baseUrl);
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await cleanup();
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM split_legs`);
  await query(`DELETE FROM split_instructions`);
  await query(`DELETE FROM split_sequence`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'spl-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'split.%' OR event_type LIKE 'ledger.%'`);
  for (const c of PARTICIPANTS) await setEndpoints(c, baseUrl);
});

describe('overlays-split — happy path', () => {
  it('4-way split: marketplace 70 / rider 20 / platform 5 / tax 5 → all CONFIRMED', async () => {
    const out = await overlaysSplitService.create({
      payerParticipant: PAYER,
      payerAccountNumber: '0SP0000001',
      payerName: 'Kofi Buyer',
      totalAmountMinor: '10000',
      currency: 'GHS',
      reference: 'order-42',
      legs: [
        { beneficiaryParticipant: B1, beneficiaryAccountNumber: '0S10000001', beneficiaryName: 'Marketplace', amountMinor: '7000' },
        { beneficiaryParticipant: B2, beneficiaryAccountNumber: '0S20000001', beneficiaryName: 'Rider',       amountMinor: '2000' },
        { beneficiaryParticipant: B3, beneficiaryAccountNumber: '0S30000001', beneficiaryName: 'Platform',    amountMinor: '500' },
        { beneficiaryParticipant: B4, beneficiaryAccountNumber: '0S40000001', beneficiaryName: 'Tax',         amountMinor: '500' }
      ]
    });
    expect(out.split.state).toBe(SPLIT_STATES.COMPLETED);
    expect(out.legs.length).toBe(4);
    expect(out.legs.every((r) => r.ok && r.txState === 'CONFIRMED')).toBe(true);
    const legs = await overlaysSplitService.listLegs(out.split.id);
    expect(legs.length).toBe(4);
    expect(legs.every((l) => l.transaction_id !== null && l.result === 'SUCCESS')).toBe(true);
  });
});

describe('overlays-split — atomicity', () => {
  it('a leg targeting a frozen account fails the split as FAILED', async () => {
    await directoryService.register({ participantCode: B1, accountType: 'BANK_ACCOUNT', accountNumber: '9999000003', accountName: 'Frozen', currency: 'GHS' });
    const out = await overlaysSplitService.create({
      payerParticipant: PAYER,
      payerAccountNumber: '0SP0000001',
      payerName: 'Kofi Buyer',
      totalAmountMinor: '5000',
      currency: 'GHS',
      legs: [
        { beneficiaryParticipant: B1, beneficiaryAccountNumber: '9999000003', beneficiaryName: 'Frozen',   amountMinor: '2500' },
        { beneficiaryParticipant: B2, beneficiaryAccountNumber: '0S20000001', beneficiaryName: 'Rider',    amountMinor: '2500' }
      ]
    });
    expect(out.split.state).toBe(SPLIT_STATES.FAILED);
    const legs = await overlaysSplitService.listLegs(out.split.id);
    expect(legs.some((l) => l.result?.startsWith('FAILED'))).toBe(true);
  });
});

describe('overlays-split — validation', () => {
  it('rejects when sum-of-legs ≠ total', async () => {
    await expect(
      overlaysSplitService.create({
        payerParticipant: PAYER,
        payerAccountNumber: '0SP0000001',
        payerName: 'Kofi',
        totalAmountMinor: '10000',
        currency: 'GHS',
        legs: [
          { beneficiaryParticipant: B1, beneficiaryAccountNumber: '0S10000001', beneficiaryName: 'A', amountMinor: '4000' },
          { beneficiaryParticipant: B2, beneficiaryAccountNumber: '0S20000001', beneficiaryName: 'B', amountMinor: '5000' }
        ]
      })
    ).rejects.toThrow(/sum/);
  });

  it('rejects fewer than 2 legs', async () => {
    await expect(
      overlaysSplitService.create({
        payerParticipant: PAYER,
        payerAccountNumber: '0SP0000001',
        payerName: 'Kofi',
        totalAmountMinor: '1000',
        currency: 'GHS',
        legs: [{ beneficiaryParticipant: B1, beneficiaryAccountNumber: '0S10000001', beneficiaryName: 'A', amountMinor: '1000' }]
      })
    ).rejects.toThrow(/legs count/);
  });

  it('rejects unknown beneficiary', async () => {
    await expect(
      overlaysSplitService.create({
        payerParticipant: PAYER,
        payerAccountNumber: '0SP0000001',
        payerName: 'Kofi',
        totalAmountMinor: '2000',
        currency: 'GHS',
        legs: [
          { beneficiaryParticipant: B1, beneficiaryAccountNumber: 'NOT_REAL',   beneficiaryName: 'Ghost', amountMinor: '1000' },
          { beneficiaryParticipant: B2, beneficiaryAccountNumber: '0S20000001', beneficiaryName: 'B',     amountMinor: '1000' }
        ]
      })
    ).rejects.toThrow(/not found/);
  });
});
