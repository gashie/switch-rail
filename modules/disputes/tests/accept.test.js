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
import { ledgerService, accountCodeFor } from '../../ledger/index.js';
import {
  disputesService,
  REASON_CODES,
  STATES
} from '../index.js';
import {
  registerRunner,
  _resetRunners
} from '../auto-resolver.js';

const ORIG = 'D7A_BANK_O';
const BENE = 'D7A_BANK_B';
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
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'd7a-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'dispute.%' OR event_type LIKE 'ledger.%'`);
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

const fingerprint = (s) =>
  Array.from(new Uint8Array(32))
    .map((_, i) => ((s.charCodeAt(i % s.length) + i * 7) & 0xff).toString(16).padStart(2, '0'))
    .join('');

const ensureBeneAccount = async (account) => {
  await directoryService.register({
    participantCode: BENE, accountType: 'BANK_ACCOUNT',
    accountNumber: account, accountName: 'Beneficiary', currency: 'GHS'
  });
};

const buildEnv = (idx, beneAccount = '0234000001') =>
  createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'REST',
    sourceMessageId: `d7a-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `d7a-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `d7a-idem-${Date.now()}-${idx}-${Math.random()}`,
    originator: { participantCode: ORIG, accountId: '0123000001', accountType: 'BANK_ACCOUNT', name: 'Originator' },
    beneficiary: { participantCode: BENE, accountId: beneAccount, accountType: 'BANK_ACCOUNT', name: 'Beneficiary' },
    amount: { value: '15000', currency: 'GHS' }
  });

const confirmTx = async (idx, beneAccount = '0234000001') => {
  await ensureBeneAccount(beneAccount);
  const env = buildEnv(idx, beneAccount);
  const r = await transactionsOrchestrator.process(env);
  if (r.transaction.state !== 'CONFIRMED') {
    throw new Error(`expected CONFIRMED, got ${r.transaction.state}`);
  }
  return r.transaction;
};

const fileGoodsNotReceived = async (txId, customerRef = 'CUST-A') =>
  disputesService.file({
    transactionId: txId,
    reasonCode: REASON_CODES.GOODS_NOT_RECEIVED,
    filingParticipant: ORIG,
    filingUserRef: customerRef,
    verificationFingerprint: fingerprint(customerRef)
  });

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
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'd7a-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'dispute.%' OR event_type LIKE 'ledger.%'`);
  _resetRunners();
  await setEndpoints(BENE, baseUrl);
});

describe('disputes — processFiled happy path', () => {
  it('FILED → ACCEPTED → EVIDENCE_PENDING with reserve held', async () => {
    const tx = await confirmTx(1);
    const filed = await fileGoodsNotReceived(tx.id, 'CUST-A1');
    expect(filed.state).toBe(STATES.FILED);

    const r = await disputesService.processFiled(filed.id);
    expect(r.case.state).toBe(STATES.EVIDENCE_PENDING);
    expect(r.case.reserve_journal_id).toBeTruthy();
    expect(r.case.evidence_pending_until).toBeTruthy();

    // Reserve balances correct.
    const beneCode = accountCodeFor({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: BENE, currency: 'GHS' });
    const reserveCode = accountCodeFor({ accountType: 'RAIL_DISPUTE_RESERVE', currency: 'GHS' });
    const beneBal = await ledgerService.balanceFor(beneCode);
    const reserveBal = await ledgerService.balanceFor(reserveCode);
    // Beneficiary started at +15000 from credit-leg confirmed; -15000 from
    // dispute hold = 0. Reserve started at 0; +15000 = 15000.
    expect(reserveBal).toBe(15000n);
    expect(beneBal).toBe(0n);

    // Audit chain.
    const audit = await query(
      `SELECT event_type FROM audit_events WHERE resource_id = $1 ORDER BY ts ASC`,
      [filed.id]
    );
    const types = audit.rows.map((row) => row.event_type);
    expect(types).toContain('dispute.filed');
    expect(types).toContain('dispute.accepted');
    expect(types).toContain('dispute.evidence_requested');
  });

  it('processFiled is a no-op on a non-FILED case', async () => {
    const tx = await confirmTx(2);
    const filed = await fileGoodsNotReceived(tx.id, 'CUST-A2');
    await disputesService.processFiled(filed.id);
    const second = await disputesService.processFiled(filed.id);
    expect(second.advanced).toBe(false);
    expect(second.case.state).toBe(STATES.EVIDENCE_PENDING);
  });
});

describe('disputes — auto-resolver routing', () => {
  it('routes to AUTO_RESOLVED when a registered runner returns resolvable', async () => {
    registerRunner('r-fraud', async () => ({
      resolvable: true,
      outcome: 'UPHOLD',
      rationaleCode: 'AUTO_FRAUD_FASTTRACK_COMPLETED'
    }));

    const tx = await confirmTx(3);
    const filed = await disputesService.file({
      transactionId: tx.id,
      reasonCode: REASON_CODES.FRAUD,
      filingParticipant: ORIG,
      filingUserRef: 'CUST-AUTO',
      verificationFingerprint: fingerprint('CUST-AUTO')
    });
    const r = await disputesService.processFiled(filed.id);
    expect(r.case.state).toBe(STATES.AUTO_RESOLVED);
    expect(r.case.outcome).toBe('UPHOLD');
    const audit = await query(
      `SELECT event_type FROM audit_events WHERE resource_id = $1`,
      [filed.id]
    );
    expect(audit.rows.map((x) => x.event_type)).toContain('dispute.auto_resolved');
  });

  it('falls through to EVIDENCE_PENDING when runner returns resolvable=false', async () => {
    registerRunner('r-duplicate', async () => ({ resolvable: false }));

    const tx = await confirmTx(4);
    const filed = await disputesService.file({
      transactionId: tx.id,
      reasonCode: REASON_CODES.DUPLICATE,
      filingParticipant: ORIG,
      filingUserRef: 'CUST-FT',
      verificationFingerprint: fingerprint('CUST-FT')
    });
    const r = await disputesService.processFiled(filed.id);
    expect(r.case.state).toBe(STATES.EVIDENCE_PENDING);
  });
});

describe('disputes — auto-validation rejection', () => {
  it('rejects when underlying tx was operator-killed between filing and processing', async () => {
    const tx = await confirmTx(5);
    const filed = await fileGoodsNotReceived(tx.id, 'CUST-VAL');
    // Mutate the tx into a non-CONFIRMED state to simulate drift.
    await query(`UPDATE transactions SET state = 'FAILED' WHERE id = $1`, [tx.id]);
    const r = await disputesService.processFiled(filed.id);
    expect(r.rejected).toBe(true);
    expect(r.case.state).toBe(STATES.REJECTED);
    expect(r.case.outcome_notes).toMatch(/FAILED/);
  });
});

describe('disputes — reserve idempotency', () => {
  it('reserveHolder is a no-op the second time (already held)', async () => {
    const tx = await confirmTx(6);
    const filed = await fileGoodsNotReceived(tx.id, 'CUST-IDEM');
    const r1 = await disputesService.processFiled(filed.id);
    const journalId = r1.case.reserve_journal_id;
    expect(journalId).toBeTruthy();
    // Second call is a no-op; reserve_journal_id stays the same; no new
    // ledger journal posted.
    const beforeJournals = await query(`SELECT count(*)::int n FROM ledger_journal`);
    await disputesService.processFiled(filed.id);
    const afterJournals = await query(`SELECT count(*)::int n FROM ledger_journal`);
    expect(beforeJournals.rows[0].n).toBe(afterJournals.rows[0].n);
  });
});
