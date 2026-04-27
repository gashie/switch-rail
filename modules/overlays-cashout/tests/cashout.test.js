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
import { overlaysCashoutService, STATES } from '../index.js';

const CUST = 'CSH_CUSTOMER';
const AGT = 'CSH_AGENT';
let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM cashout_requests`);
  await query(`DELETE FROM cashout_request_sequence`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [CUST, AGT]);
  await query(`DELETE FROM ledger_accounts`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'csh-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [CUST, AGT]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [CUST, AGT]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [CUST, AGT]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [CUST, AGT]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'cashout.%' OR event_type LIKE 'ledger.%'`);
  await query(`DELETE FROM fee_schedules`);
  await query(`DELETE FROM participants WHERE code IN ($1,$2)`, [CUST, AGT]);
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
  await onboardActive(CUST);
  await onboardActive(AGT);
  await directoryService.register({ participantCode: CUST, accountType: 'BANK_ACCOUNT', accountNumber: '0CC0000001', accountName: 'Customer', currency: 'GHS' });
  await directoryService.register({ participantCode: AGT, accountType: 'AGENT_FLOAT', accountNumber: '0AG0000001', accountName: 'Agent Float', currency: 'GHS' });
  // A non-AGENT_FLOAT account on the agent participant for the negative test.
  await directoryService.register({ participantCode: AGT, accountType: 'BANK_ACCOUNT', accountNumber: '0AG_NORMAL', accountName: 'Agent Normal', currency: 'GHS' });
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
  await setEndpoints(CUST, baseUrl);
  await setEndpoints(AGT, baseUrl);
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await cleanup();
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM cashout_requests`);
  await query(`DELETE FROM cashout_request_sequence`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'csh-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'cashout.%' OR event_type LIKE 'ledger.%'`);
  await setEndpoints(CUST, baseUrl);
  await setEndpoints(AGT, baseUrl);
});

const initiate = (overrides = {}) =>
  overlaysCashoutService.initiate({
    customerParticipant: CUST,
    customerAccountNumber: '0CC0000001',
    agentParticipant: AGT,
    agentFloatAccountNumber: '0AG0000001',
    amountMinor: '5000',
    currency: 'GHS',
    expiresInMinutes: 15,
    ...overrides
  });

describe('overlays-cashout — initiate', () => {
  it('creates an INITIATED request with OTP', async () => {
    const r = await initiate();
    expect(r.state).toBe(STATES.INITIATED);
    expect(r.request_number).toMatch(/^CSH-\d{6}-000001$/);
    expect(r.agent_otp).toMatch(/^\d{6}$/);
  });

  it('rejects when agent account is not AGENT_FLOAT', async () => {
    await expect(
      initiate({ agentFloatAccountNumber: '0AG_NORMAL' })
    ).rejects.toThrow(/AGENT_FLOAT/);
  });
});

describe('overlays-cashout — authorize → complete happy path', () => {
  it('full flow: initiate → authorize → complete with right OTP → COMPLETED + tx CONFIRMED', async () => {
    const r = await initiate();
    await overlaysCashoutService.authorize({ requestNumber: r.request_number });
    const out = await overlaysCashoutService.complete({
      requestNumber: r.request_number,
      otp: r.agent_otp,
      customerName: 'Kofi Customer'
    });
    expect(out.transaction.state).toBe('CONFIRMED');
    expect(out.request.state).toBe(STATES.COMPLETED);
    expect(out.request.transaction_id).toBe(out.transaction.id);
    expect(out.request.agent_otp).toBeNull();
  });

  it('wrong OTP rejected, attempts counter increments durably', async () => {
    const r = await initiate();
    await overlaysCashoutService.authorize({ requestNumber: r.request_number });
    await expect(
      overlaysCashoutService.complete({
        requestNumber: r.request_number,
        otp: '000000',
        customerName: 'Kofi'
      })
    ).rejects.toThrow(/INVALID_OTP|OTP/);
    const after = await overlaysCashoutService.findByNumber(r.request_number);
    expect(after.agent_otp_attempts).toBe(1);
  });

  it('exhausted OTP attempts cancel the request', async () => {
    const r = await initiate();
    await overlaysCashoutService.authorize({ requestNumber: r.request_number });
    // Bump attempts to the max via direct DB so we hit the threshold quickly.
    await query(`UPDATE cashout_requests SET agent_otp_attempts = 3 WHERE id = $1`, [r.id]);
    await expect(
      overlaysCashoutService.complete({
        requestNumber: r.request_number,
        otp: '000000',
        customerName: 'Kofi'
      })
    ).rejects.toThrow(/attempts exhausted/);
    const after = await overlaysCashoutService.findByNumber(r.request_number);
    expect(after.state).toBe(STATES.CANCELLED);
  });
});

describe('overlays-cashout — expiry', () => {
  it('complete after expiry rejected, state EXPIRED', async () => {
    const r = await initiate();
    await overlaysCashoutService.authorize({ requestNumber: r.request_number });
    await query(`UPDATE cashout_requests SET expires_at = now() - interval '1 minute' WHERE id = $1`, [r.id]);
    await expect(
      overlaysCashoutService.complete({
        requestNumber: r.request_number,
        otp: r.agent_otp,
        customerName: 'Kofi'
      })
    ).rejects.toThrow(/expired/);
    const after = await overlaysCashoutService.findByNumber(r.request_number);
    expect(after.state).toBe(STATES.EXPIRED);
  });
});

describe('overlays-cashout — cancel', () => {
  it('cancel a non-terminal request', async () => {
    const r = await initiate();
    const c = await overlaysCashoutService.cancel({
      requestNumber: r.request_number,
      cancelledBy: 'CUSTOMER',
      reason: 'changed mind'
    });
    expect(c.state).toBe(STATES.CANCELLED);
  });
});
