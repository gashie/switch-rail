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
import { ledgerService, accountCodeFor } from '../../ledger/index.js';
import { uuidv7 } from '../../../core/uuid.js';
import {
  disputesService,
  disputesEvidenceService,
  disputesDecisionService,
  disputesSettlementService,
  REASON_CODES,
  STATES,
  registerDefaultRunners,
  _resetRunners
} from '../index.js';

const ORIG = 'D7S_BANK_O';
const BENE = 'D7S_BANK_B';
let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM dispute_decisions`);
  await query(`DELETE FROM dispute_evidence`);
  await query(`DELETE FROM dispute_status_history`);
  await query(`DELETE FROM dispute_cases`);
  await query(`DELETE FROM dispute_case_sequence`);
  await query(`DELETE FROM fast_track_reversals`);
  await query(`DELETE FROM reconciliation_breaks`);
  await query(`DELETE FROM reconciliation_runs`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM ledger_accounts`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'd7s-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM users WHERE email LIKE 'd7s-%'`);
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
    sourceMessageId: `d7s-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `d7s-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `d7s-idem-${Date.now()}-${idx}-${Math.random()}`,
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

const advanceToAdjudicating = async (caseRow) => {
  await query(
    `UPDATE dispute_cases SET evidence_pending_until = now() - interval '1 hour' WHERE id = $1`,
    [caseRow.id]
  );
  await disputesEvidenceService.expireWindowAndAdvance(caseRow.id);
};

const fileAndProcess = async ({ txId, reasonCode, customerRef = 'CUST-S' }) => {
  const filed = await disputesService.file({
    transactionId: txId,
    reasonCode,
    filingParticipant: ORIG,
    filingUserRef: customerRef,
    verificationFingerprint: fingerprint(customerRef)
  });
  const r = await disputesService.processFiled(filed.id);
  return r.case;
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
  await query(`DELETE FROM dispute_decisions`);
  await query(`DELETE FROM dispute_evidence`);
  await query(`DELETE FROM dispute_status_history`);
  await query(`DELETE FROM dispute_cases`);
  await query(`DELETE FROM dispute_case_sequence`);
  await query(`DELETE FROM fast_track_reversals`);
  await query(`DELETE FROM reconciliation_breaks`);
  await query(`DELETE FROM reconciliation_runs`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'd7s-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'dispute.%' OR event_type LIKE 'ledger.%'`);
  _resetRunners();
  await registerDefaultRunners();
  await setEndpoints(BENE, baseUrl);
});

const balances = async (currency = 'GHS') => {
  const reserveCode = accountCodeFor({ accountType: 'RAIL_DISPUTE_RESERVE', currency });
  const origCode = accountCodeFor({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: ORIG, currency });
  const beneCode = accountCodeFor({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: BENE, currency });
  return {
    reserve: await ledgerService.balanceFor(reserveCode),
    originator: await ledgerService.balanceFor(origCode),
    beneficiary: await ledgerService.balanceFor(beneCode)
  };
};

describe('disputes — settlement: auto-resolved UPHOLD', () => {
  it('auto-DUPLICATE settles atomically: refund to originator + original tx REVERSED', async () => {
    // Build two duplicate-looking confirmed transactions.
    const tx1 = await confirmTx(1);
    const tx2 = await confirmTx(2);
    await query(
      `UPDATE transactions SET created_at = (SELECT created_at FROM transactions WHERE id = $2) + interval '5 seconds' WHERE id = $1`,
      [tx2.id, tx1.id]
    );

    const c = await fileAndProcess({ txId: tx2.id, reasonCode: REASON_CODES.DUPLICATE, customerRef: 'CUST-AUS-1' });
    expect(c.state).toBe(STATES.AUTO_RESOLVED);
    const before = await balances();

    const r = await disputesSettlementService.settleAutoResolved({ caseNumber: c.case_number });
    expect(r.case.state).toBe(STATES.SETTLED);
    expect(r.case.release_journal_id).toBeTruthy();

    const after = await balances();
    // Reserve releases back to originator.
    expect(after.reserve - before.reserve).toBe(-BigInt(c.amount_minor));
    expect(after.originator - before.originator).toBe(BigInt(c.amount_minor));

    // Original tx unwound.
    const updatedTx = await transactionsService.findById(tx2.id);
    expect(updatedTx.state).toBe('REVERSED');
  });
});

describe('disputes — settlement: manual UPHELD via confirm-settlement', () => {
  it('decision posts no journal; confirm-settlement posts release + reversal', async () => {
    // Create two distinct user UUIDs (not real auth, just placeholders).
    const deciderId = uuidv7();
    const confirmerId = uuidv7();
    await query(
      `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, 'x', 'Decider'), ($3, $4, 'x', 'Confirmer')`,
      [deciderId, `d7s-decider-${deciderId}@x.gh`, confirmerId, `d7s-confirmer-${confirmerId}@x.gh`]
    );

    const tx = await confirmTx(3);
    const c = await fileAndProcess({ txId: tx.id, reasonCode: REASON_CODES.GOODS_NOT_RECEIVED, customerRef: 'CUST-S-1' });
    await advanceToAdjudicating(c);
    await disputesDecisionService.decideManually({
      caseNumber: c.case_number,
      outcome: 'UPHOLD',
      rationaleCode: 'EVIDENCE_FAVORS_FILER',
      decidedByUser: deciderId
    });
    const after_decision = await disputesService.findByCaseNumber(c.case_number);
    expect(after_decision.state).toBe(STATES.UPHELD);
    expect(after_decision.release_journal_id).toBeNull();

    const before = await balances();
    const settled = await disputesSettlementService.confirmSettlement({
      caseNumber: c.case_number,
      confirmedByUser: confirmerId
    });
    expect(settled.case.state).toBe(STATES.SETTLED);
    const after = await balances();
    expect(after.reserve - before.reserve).toBe(-BigInt(c.amount_minor));
    expect(after.originator - before.originator).toBe(BigInt(c.amount_minor));

    const updatedTx = await transactionsService.findById(tx.id);
    expect(updatedTx.state).toBe('REVERSED');
  });

  it('maker-checker: same user cannot decide AND confirm', async () => {
    const userId = uuidv7();
    await query(
      `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, 'x', 'Solo')`,
      [userId, `d7s-solo-${userId}@x.gh`]
    );
    const tx = await confirmTx(4);
    const c = await fileAndProcess({ txId: tx.id, reasonCode: REASON_CODES.GOODS_NOT_RECEIVED, customerRef: 'CUST-S-2' });
    await advanceToAdjudicating(c);
    await disputesDecisionService.decideManually({
      caseNumber: c.case_number,
      outcome: 'UPHOLD',
      rationaleCode: 'EVIDENCE_FAVORS_FILER',
      decidedByUser: userId
    });
    await expect(
      disputesSettlementService.confirmSettlement({
        caseNumber: c.case_number,
        confirmedByUser: userId
      })
    ).rejects.toThrow(/maker-checker/);
  });
});

describe('disputes — settlement: manual DENIED', () => {
  it('confirm-settlement on DENIED returns reserve to beneficiary, no reversal', async () => {
    const deciderId = uuidv7();
    const confirmerId = uuidv7();
    await query(
      `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, 'x', 'D1'), ($3, $4, 'x', 'C1')`,
      [deciderId, `d7s-d-${deciderId}@x.gh`, confirmerId, `d7s-c-${confirmerId}@x.gh`]
    );
    const tx = await confirmTx(5);
    const c = await fileAndProcess({ txId: tx.id, reasonCode: REASON_CODES.GOODS_NOT_RECEIVED, customerRef: 'CUST-S-3' });
    await advanceToAdjudicating(c);
    await disputesDecisionService.decideManually({
      caseNumber: c.case_number,
      outcome: 'REJECT',
      rationaleCode: 'EVIDENCE_FAVORS_RESPONDER',
      decidedByUser: deciderId
    });
    const before = await balances();
    const r = await disputesSettlementService.confirmSettlement({
      caseNumber: c.case_number,
      confirmedByUser: confirmerId
    });
    expect(r.case.state).toBe(STATES.SETTLED);
    const after = await balances();
    expect(after.reserve - before.reserve).toBe(-BigInt(c.amount_minor));
    expect(after.beneficiary - before.beneficiary).toBe(BigInt(c.amount_minor));
    // No reversal initiated for DENIED.
    const updatedTx = await transactionsService.findById(tx.id);
    expect(updatedTx.state).toBe('CONFIRMED');
  });
});

describe('disputes — settlement: PARTIAL_UPHELD three-leg journal', () => {
  it('split journal: filer gets upheld portion, beneficiary keeps the rest', async () => {
    const deciderId = uuidv7();
    const confirmerId = uuidv7();
    await query(
      `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, 'x', 'D2'), ($3, $4, 'x', 'C2')`,
      [deciderId, `d7s-d2-${deciderId}@x.gh`, confirmerId, `d7s-c2-${confirmerId}@x.gh`]
    );
    const tx = await confirmTx(6);
    const c = await fileAndProcess({ txId: tx.id, reasonCode: REASON_CODES.GOODS_NOT_RECEIVED, customerRef: 'CUST-S-4' });
    await advanceToAdjudicating(c);
    const upheldShare = '6000';
    const rejectedShare = BigInt(c.amount_minor) - BigInt(upheldShare);
    await disputesDecisionService.decideManually({
      caseNumber: c.case_number,
      outcome: 'PARTIAL',
      rationaleCode: 'CUSTOMER_BEHAVIOR_CONTRIBUTED',
      outcomeAmountMinor: upheldShare,
      decidedByUser: deciderId
    });
    const before = await balances();
    const r = await disputesSettlementService.confirmSettlement({
      caseNumber: c.case_number,
      confirmedByUser: confirmerId
    });
    expect(r.case.state).toBe(STATES.SETTLED);
    const after = await balances();
    expect(after.reserve - before.reserve).toBe(-BigInt(c.amount_minor));
    expect(after.originator - before.originator).toBe(BigInt(upheldShare));
    expect(after.beneficiary - before.beneficiary).toBe(rejectedShare);
  });
});

describe('disputes — settlement: idempotency', () => {
  it('confirm-settlement on a SETTLED case is a no-op', async () => {
    const deciderId = uuidv7();
    const confirmerId = uuidv7();
    await query(
      `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, 'x', 'D3'), ($3, $4, 'x', 'C3')`,
      [deciderId, `d7s-d3-${deciderId}@x.gh`, confirmerId, `d7s-c3-${confirmerId}@x.gh`]
    );
    const tx = await confirmTx(7);
    const c = await fileAndProcess({ txId: tx.id, reasonCode: REASON_CODES.GOODS_NOT_RECEIVED, customerRef: 'CUST-S-5' });
    await advanceToAdjudicating(c);
    await disputesDecisionService.decideManually({
      caseNumber: c.case_number,
      outcome: 'UPHOLD',
      rationaleCode: 'EVIDENCE_FAVORS_FILER',
      decidedByUser: deciderId
    });
    await disputesSettlementService.confirmSettlement({
      caseNumber: c.case_number,
      confirmedByUser: confirmerId
    });
    const beforeJournals = await query(`SELECT count(*)::int n FROM ledger_journal`);
    const r2 = await disputesSettlementService.confirmSettlement({
      caseNumber: c.case_number,
      confirmedByUser: confirmerId
    });
    expect(r2.deduped).toBe(true);
    const afterJournals = await query(`SELECT count(*)::int n FROM ledger_journal`);
    expect(beforeJournals.rows[0].n).toBe(afterJournals.rows[0].n);
  });
});
