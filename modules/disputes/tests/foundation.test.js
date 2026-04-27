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
import {
  disputesService,
  REASON_CODES,
  SLA_WINDOWS,
  STATES,
  isTerminal,
  canTransition,
  FILING_RATE_LIMIT
} from '../index.js';

const ORIG = 'D7_BANK_O';
const BENE = 'D7_BANK_B';
let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM dispute_status_history`);
  await query(`DELETE FROM dispute_cases`);
  await query(`DELETE FROM dispute_case_sequence`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM ledger_accounts`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'd7-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'dispute.%'`);
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

const buildEnv = (idx, beneAccount = '0234000001') =>
  createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'REST',
    sourceMessageId: `d7-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `d7-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `d7-idem-${Date.now()}-${idx}-${Math.random()}`,
    originator: { participantCode: ORIG, accountId: '0123000001', accountType: 'BANK_ACCOUNT', name: 'Originator' },
    beneficiary: { participantCode: BENE, accountId: beneAccount, accountType: 'BANK_ACCOUNT', name: 'Beneficiary' },
    amount: { value: '15000', currency: 'GHS' }
  });

const fingerprint = (s) =>
  // Reproducible 64-char hex for the verification fingerprint test slot.
  Array.from(new Uint8Array(32))
    .map((_, i) => ((s.charCodeAt(i % s.length) + i * 7) & 0xff).toString(16).padStart(2, '0'))
    .join('');

const ensureBeneAccount = async (account) => {
  await directoryService.register({
    participantCode: BENE, accountType: 'BANK_ACCOUNT',
    accountNumber: account, accountName: 'Beneficiary', currency: 'GHS'
  });
};

const confirmTx = async (idx, beneAccount = '0234000001') => {
  await ensureBeneAccount(beneAccount);
  const env = buildEnv(idx, beneAccount);
  const r = await transactionsOrchestrator.process(env);
  if (r.transaction.state !== 'CONFIRMED') {
    throw new Error(`expected CONFIRMED, got ${r.transaction.state}`);
  }
  return r.transaction;
};

beforeAll(async () => {
  await cleanup();
  await onboardActive(ORIG);
  await onboardActive(BENE);
  await directoryService.register({
    participantCode: ORIG, accountType: 'BANK_ACCOUNT',
    accountNumber: '0123000001', accountName: 'Originator', currency: 'GHS'
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
  await setEndpoints(BENE, baseUrl);
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await cleanup();
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM dispute_status_history`);
  await query(`DELETE FROM dispute_cases`);
  await query(`DELETE FROM dispute_case_sequence`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'd7-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'dispute.%' OR event_type LIKE 'ledger.%'`);
  await setEndpoints(BENE, baseUrl);
});

describe('disputes — locked constants', () => {
  it('exposes the locked Phase 7 reason code set + Phase 8 overlay extensions', () => {
    expect(Object.keys(REASON_CODES).sort()).toEqual([
      // Phase 7 — base 8.
      'DUPLICATE', 'FRAUD', 'GOODS_NOT_RECEIVED', 'REGULATORY',
      'TECHNICAL', 'UNAUTHORIZED', 'WRONG_AMOUNT', 'WRONG_BENEFICIARY',
      // Phase 8 — overlay-specific extensions.
      'ESCROW_RELEASE_DISPUTED', 'MANDATE_EXCESS', 'MANDATE_UNAUTHORIZED',
      'R2P_DUPLICATE', 'REFUND_DUPLICATE'
    ].sort());
    for (const code of Object.values(REASON_CODES)) {
      expect(SLA_WINDOWS[code]).toBeTruthy();
      expect(typeof SLA_WINDOWS[code].responseDays).toBe('number');
    }
    expect(SLA_WINDOWS.REGULATORY.fileWithinDays).toBeNull();
    expect(SLA_WINDOWS.FRAUD.fileWithinDays).toBe(80);
    expect(SLA_WINDOWS.DUPLICATE.fileWithinDays).toBe(90);
  });

  it('state machine has the locked terminal set', () => {
    expect(isTerminal(STATES.SETTLED)).toBe(true);
    expect(isTerminal(STATES.REJECTED)).toBe(true);
    expect(isTerminal(STATES.FILED)).toBe(false);
    expect(isTerminal(STATES.DENIED)).toBe(false);
    expect(canTransition(STATES.FILED, STATES.ACCEPTED)).toBe(true);
    expect(canTransition(STATES.FILED, STATES.SETTLED)).toBe(false);
    expect(canTransition(STATES.SETTLED, STATES.UPHELD)).toBe(false);
  });
});

describe('disputes — file (happy path)', () => {
  it('files a valid case → state FILED, case_number is DSP-YYYYMM-000001', async () => {
    const tx = await confirmTx(1);
    const c = await disputesService.file({
      transactionId: tx.id,
      reasonCode: REASON_CODES.GOODS_NOT_RECEIVED,
      filingParticipant: ORIG,
      filingUserRef: 'CUST-001',
      verificationFingerprint: fingerprint('CUST-001'),
      evidence: { source: 'unit-test' }
    });
    expect(c.state).toBe(STATES.FILED);
    expect(c.case_number).toMatch(/^DSP-\d{6}-000001$/);
    expect(c.transaction_id).toBe(tx.id);
    expect(c.reason_code).toBe(REASON_CODES.GOODS_NOT_RECEIVED);
    expect(String(c.amount_minor)).toBe('15000');

    const audit = await query(
      `SELECT event_type FROM audit_events WHERE resource_id = $1 AND event_type = 'dispute.filed'`,
      [c.id]
    );
    expect(audit.rows.length).toBe(1);
  });

  it('case numbers are monotonic per month', async () => {
    const tx1 = await confirmTx(2);
    const tx2 = await confirmTx(3, '0234000002');
    const c1 = await disputesService.file({
      transactionId: tx1.id,
      reasonCode: REASON_CODES.GOODS_NOT_RECEIVED,
      filingParticipant: ORIG,
      filingUserRef: 'CUST-002a',
      verificationFingerprint: fingerprint('CUST-002a')
    });
    const c2 = await disputesService.file({
      transactionId: tx2.id,
      reasonCode: REASON_CODES.GOODS_NOT_RECEIVED,
      filingParticipant: ORIG,
      filingUserRef: 'CUST-002b',
      verificationFingerprint: fingerprint('CUST-002b')
    });
    const seq1 = Number(c1.case_number.split('-')[2]);
    const seq2 = Number(c2.case_number.split('-')[2]);
    expect(seq2).toBe(seq1 + 1);
  });
});

describe('disputes — file validation', () => {
  it('rejects unknown reason code', async () => {
    const tx = await confirmTx(4);
    await expect(
      disputesService.file({
        transactionId: tx.id,
        reasonCode: 'NOT_A_REASON',
        filingParticipant: ORIG,
        filingUserRef: 'CUST-003',
        verificationFingerprint: fingerprint('CUST-003')
      })
    ).rejects.toThrow(/unknown reasonCode/);
  });

  it('rejects when transaction not found', async () => {
    await expect(
      disputesService.file({
        transactionId: '00000000-0000-7000-8000-000000000000',
        reasonCode: REASON_CODES.FRAUD,
        filingParticipant: ORIG,
        filingUserRef: 'CUST-004',
        verificationFingerprint: fingerprint('CUST-004')
      })
    ).rejects.toThrow(/not found/);
  });

  it('rejects when filing window expired', async () => {
    const tx = await confirmTx(5);
    // Backdate to 100 days ago — beyond FRAUD's 80-day window.
    await query(
      `UPDATE transactions SET confirmed_at = now() - interval '100 days' WHERE id = $1`,
      [tx.id]
    );
    await expect(
      disputesService.file({
        transactionId: tx.id,
        reasonCode: REASON_CODES.FRAUD,
        filingParticipant: ORIG,
        filingUserRef: 'CUST-005',
        verificationFingerprint: fingerprint('CUST-005')
      })
    ).rejects.toThrow(/window expired/);
    // Verify the rejected case was persisted.
    const cases = await disputesService.listForTransaction(tx.id);
    expect(cases.length).toBe(1);
    expect(cases[0].state).toBe(STATES.REJECTED);
    expect(cases[0].metadata.rejection).toBe('WINDOW_EXPIRED');
  });

  it('REGULATORY reason has no filing window', async () => {
    const tx = await confirmTx(6);
    // Backdate way out — REGULATORY accepts anyway.
    await query(
      `UPDATE transactions SET confirmed_at = now() - interval '500 days' WHERE id = $1`,
      [tx.id]
    );
    const c = await disputesService.file({
      transactionId: tx.id,
      reasonCode: REASON_CODES.REGULATORY,
      filingParticipant: ORIG,
      filingUserRef: 'COURT-001',
      verificationFingerprint: fingerprint('COURT-001')
    });
    expect(c.state).toBe(STATES.FILED);
  });
});

describe('disputes — rate limit', () => {
  it('rejects the (limit+1)th filing in the rate window', async () => {
    // Rate-limit cap is 100 in 24h per (participant, customer-ref). Insert
    // dummy historical rows for the same customer-ref then file once to hit
    // the boundary.
    const tx = await confirmTx(7);
    const customerRef = 'CUST-RATE';
    // Pre-insert N=cap historical filings for this customer-ref. We mark them
    // all REJECTED so they don't compete on transaction state.
    for (let i = 0; i < FILING_RATE_LIMIT.maxPerCustomer; i += 1) {
      await query(
        `INSERT INTO dispute_cases (id, case_number, transaction_id, reason_code, filing_participant, filing_user_ref, amount_minor, currency, state)
         VALUES (gen_random_uuid(), $1, $2, 'GOODS_NOT_RECEIVED', $3, $4, '0', 'XXX', 'REJECTED')`,
        [`DSP-RATE-${String(i).padStart(6, '0')}`, tx.id, ORIG, customerRef]
      );
    }
    await expect(
      disputesService.file({
        transactionId: tx.id,
        reasonCode: REASON_CODES.GOODS_NOT_RECEIVED,
        filingParticipant: ORIG,
        filingUserRef: customerRef,
        verificationFingerprint: fingerprint(customerRef)
      })
    ).rejects.toThrow(/rate limit/);
  });
});

describe('disputes — operator kill-switch', () => {
  it('terminates a non-terminal case to DENIED with audit', async () => {
    const tx = await confirmTx(8);
    const c = await disputesService.file({
      transactionId: tx.id,
      reasonCode: REASON_CODES.GOODS_NOT_RECEIVED,
      filingParticipant: ORIG,
      filingUserRef: 'CUST-KILL',
      verificationFingerprint: fingerprint('CUST-KILL')
    });
    const killed = await disputesService.operatorKill({
      id: c.id,
      reason: 'spam filing',
      killedByUser: null
    });
    expect(killed.state).toBe(STATES.DENIED);
    const a = await query(
      `SELECT event_type FROM audit_events WHERE resource_id = $1 AND event_type = 'dispute.terminated'`,
      [c.id]
    );
    expect(a.rows.length).toBe(1);
  });
});

describe('disputes — list/findByCaseNumber', () => {
  it('finds by case number and lists for participant', async () => {
    const tx = await confirmTx(9);
    const c = await disputesService.file({
      transactionId: tx.id,
      reasonCode: REASON_CODES.UNAUTHORIZED,
      filingParticipant: ORIG,
      filingUserRef: 'CUST-LIST',
      verificationFingerprint: fingerprint('CUST-LIST')
    });
    const found = await disputesService.findByCaseNumber(c.case_number);
    expect(found?.id).toBe(c.id);
    const all = await disputesService.listForParticipant(ORIG, { limit: 10, offset: 0 });
    expect(all.some((r) => r.id === c.id)).toBe(true);
  });
});
