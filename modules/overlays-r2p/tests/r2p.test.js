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
import { overlaysR2pService, STATES } from '../index.js';

const REQ = 'R2P_BANK_REQ';
const PAY = 'R2P_BANK_PAY';
let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM r2p_requests`);
  await query(`DELETE FROM r2p_request_sequence`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [REQ, PAY]);
  await query(`DELETE FROM ledger_accounts`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'r2p-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [REQ, PAY]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [REQ, PAY]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [REQ, PAY]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [REQ, PAY]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'r2p.%' OR event_type LIKE 'ledger.%'`);
  await query(`DELETE FROM fee_schedules`);
  await query(`DELETE FROM participants WHERE code IN ($1,$2)`, [REQ, PAY]);
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
  await onboardActive(REQ);
  await onboardActive(PAY);
  await directoryService.register({ participantCode: REQ, accountType: 'BANK_ACCOUNT', accountNumber: '0R10000001', accountName: 'Requester acct', currency: 'GHS' });
  await directoryService.register({ participantCode: PAY, accountType: 'BANK_ACCOUNT', accountNumber: '0P10000001', accountName: 'Payer acct', currency: 'GHS' });
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
  await setEndpoints(REQ, baseUrl);
  await setEndpoints(PAY, baseUrl);
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await cleanup();
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM r2p_requests`);
  await query(`DELETE FROM r2p_request_sequence`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'r2p-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'r2p.%' OR event_type LIKE 'ledger.%'`);
  await setEndpoints(REQ, baseUrl);
  await setEndpoints(PAY, baseUrl);
});

const createR2p = (overrides = {}) =>
  overlaysR2pService.create({
    requesterParticipant: REQ,
    requesterAccountNumber: '0R10000001',
    payerParticipant: PAY,
    amountMinor: '5000',
    currency: 'GHS',
    reason: 'invoice',
    expiresInHours: 24,
    ...overrides
  });

describe('overlays-r2p — create', () => {
  it('creates a PENDING r2p request with R2P-YYYYMM-NNNNNN number', async () => {
    const r = await createR2p();
    expect(r.state).toBe(STATES.PENDING);
    expect(r.request_number).toMatch(/^R2P-\d{6}-000001$/);
    expect(String(r.amount_minor)).toBe('5000');
  });

  it('idempotency: same idempotencyKey returns the existing request', async () => {
    const r1 = await createR2p({ idempotencyKey: 'idem-key-abcdef' });
    const r2 = await createR2p({ idempotencyKey: 'idem-key-abcdef' });
    expect(r2.id).toBe(r1.id);
  });

  it('rejects when requester account does not exist', async () => {
    await expect(createR2p({ requesterAccountNumber: 'NO_SUCH' })).rejects.toThrow(/not found/);
  });
});

describe('overlays-r2p — authorize happy path', () => {
  it('payer authorizes → orchestrator confirms → state PAID with linked tx', async () => {
    const r = await createR2p();
    const out = await overlaysR2pService.authorize({
      requestNumber: r.request_number,
      payerAccountNumber: '0P10000001',
      payerName: 'Kofi Payer'
    });
    expect(out.transactionState).toBe('CONFIRMED');
    expect(out.request.state).toBe(STATES.PAID);
    expect(out.request.paid_transaction_id).toBe(out.transactionId);
  });

  it('re-authorize on PAID is idempotent', async () => {
    const r = await createR2p();
    const a = await overlaysR2pService.authorize({
      requestNumber: r.request_number,
      payerAccountNumber: '0P10000001',
      payerName: 'Kofi Payer'
    });
    const b = await overlaysR2pService.authorize({
      requestNumber: r.request_number,
      payerAccountNumber: '0P10000001',
      payerName: 'Kofi Payer'
    });
    expect(b.deduped).toBe(true);
    expect(b.transactionId).toBe(a.transactionId);
  });
});

describe('overlays-r2p — reject', () => {
  it('rejecting a PENDING r2p marks REJECTED with reason', async () => {
    const r = await createR2p();
    const updated = await overlaysR2pService.reject({
      requestNumber: r.request_number,
      reason: 'CUSTOMER_DECLINED',
      notes: 'not authorized'
    });
    expect(updated.state).toBe(STATES.REJECTED);
    expect(updated.rejected_reason).toBe('CUSTOMER_DECLINED');
  });

  it('rejecting an already-PAID r2p fails', async () => {
    const r = await createR2p();
    await overlaysR2pService.authorize({
      requestNumber: r.request_number,
      payerAccountNumber: '0P10000001',
      payerName: 'Kofi Payer'
    });
    await expect(
      overlaysR2pService.reject({
        requestNumber: r.request_number,
        reason: 'CUSTOMER_DECLINED'
      })
    ).rejects.toThrow(/terminal state/);
  });
});

describe('overlays-r2p — expiry', () => {
  it('authorize after expires_at fails and marks EXPIRED', async () => {
    const r = await createR2p();
    await query(`UPDATE r2p_requests SET expires_at = now() - interval '1 hour' WHERE id = $1`, [r.id]);
    await expect(
      overlaysR2pService.authorize({
        requestNumber: r.request_number,
        payerAccountNumber: '0P10000001',
        payerName: 'Kofi Payer'
      })
    ).rejects.toThrow(/expired/);
    const after = await overlaysR2pService.findByRequestNumber(r.request_number);
    expect(after.state).toBe(STATES.EXPIRED);
  });

  it('expirePending worker batch-marks all pending past deadline', async () => {
    const r1 = await createR2p({ idempotencyKey: 'a' });
    const r2 = await createR2p({ idempotencyKey: 'b' });
    await query(`UPDATE r2p_requests SET expires_at = now() - interval '1 hour' WHERE id IN ($1, $2)`, [r1.id, r2.id]);
    const out = await overlaysR2pService.expirePending();
    expect(out.count).toBe(2);
  });
});

describe('overlays-r2p — list', () => {
  it('filters by payer participant + state', async () => {
    await createR2p({ idempotencyKey: 'q1' });
    const list = await overlaysR2pService.list({ payerParticipant: PAY, state: 'PENDING', limit: 10, offset: 0 });
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.every((r) => r.payer_participant === PAY && r.state === 'PENDING')).toBe(true);
  });
});
