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
import { fastTrackReversalService } from '../../fast-track-reversal/index.js';
import { auditService } from '../../audit/index.js';
import { uuidv7 } from '../../../core/uuid.js';
import * as db from '../../../core/db.js';
import {
  disputesService,
  disputesEvidenceService,
  disputesDecisionService,
  REASON_CODES,
  STATES,
  registerDefaultRunners,
  _resetRunners
} from '../index.js';

const ORIG = 'D7J_BANK_O';
const BENE = 'D7J_BANK_B';
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
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'd7j-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'dispute.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'cop.%' OR event_type LIKE 'fast_track.%'`);
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

const buildEnv = (idx, beneAccount = '0234000001', amount = '15000') =>
  createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'REST',
    sourceMessageId: `d7j-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `d7j-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `d7j-idem-${Date.now()}-${idx}-${Math.random()}`,
    originator: { participantCode: ORIG, accountId: '0123000001', accountType: 'BANK_ACCOUNT', name: 'Originator' },
    beneficiary: { participantCode: BENE, accountId: beneAccount, accountType: 'BANK_ACCOUNT', name: 'Beneficiary' },
    amount: { value: amount, currency: 'GHS' }
  });

const confirmTx = async (idx, beneAccount = '0234000001', amount = '15000') => {
  await ensureBeneAccount(beneAccount);
  const env = buildEnv(idx, beneAccount, amount);
  const r = await transactionsOrchestrator.process(env);
  if (r.transaction.state !== 'CONFIRMED') {
    throw new Error(`expected CONFIRMED, got ${r.transaction.state}`);
  }
  return r.transaction;
};

const fileAndProcess = async ({ txId, reasonCode, customerRef = 'CUST-J' }) => {
  const filed = await disputesService.file({
    transactionId: txId,
    reasonCode,
    filingParticipant: ORIG,
    filingUserRef: customerRef,
    verificationFingerprint: fingerprint(customerRef)
  });
  const r = await disputesService.processFiled(filed.id);
  return { caseRow: r.case, autoResolved: !!r.autoResolved };
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
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'd7j-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'dispute.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'cop.%' OR event_type LIKE 'fast_track.%'`);
  // Tests in earlier files may have wiped the runner registry — re-register
  // the four real B7.4 runners so this file always sees them.
  _resetRunners();
  await registerDefaultRunners();
  await setEndpoints(BENE, baseUrl);
});

describe('disputes — auto-resolver: r-duplicate', () => {
  it('two confirmed tx within 60s with identical params → DUPLICATE auto-resolves UPHOLD', async () => {
    const tx1 = await confirmTx(1);
    const tx2 = await confirmTx(2, '0234000001');
    // Force tx2's created_at within 60s of tx1.
    await query(
      `UPDATE transactions SET created_at = (SELECT created_at FROM transactions WHERE id = $2) + interval '5 seconds' WHERE id = $1`,
      [tx2.id, tx1.id]
    );
    const { caseRow } = await fileAndProcess({
      txId: tx2.id,
      reasonCode: REASON_CODES.DUPLICATE,
      customerRef: 'CUST-DUP'
    });
    expect(caseRow.state).toBe(STATES.AUTO_RESOLVED);
    expect(caseRow.outcome).toBe('UPHOLD');
    const decision = await disputesDecisionService.findByCase(caseRow.case_number);
    expect(decision.decision_type).toBe('AUTO');
    expect(decision.rationale_code).toBe('AUTO_DUPLICATE_MATCH_FOUND');
  });

  it('isolated tx (no duplicate) → DUPLICATE falls through to EVIDENCE_PENDING', async () => {
    const tx = await confirmTx(3);
    const { caseRow } = await fileAndProcess({
      txId: tx.id,
      reasonCode: REASON_CODES.DUPLICATE,
      customerRef: 'CUST-NODUP'
    });
    expect(caseRow.state).toBe(STATES.EVIDENCE_PENDING);
  });
});

describe('disputes — auto-resolver: r-technical', () => {
  it('tx with STATUS_MISMATCH recon break → TECHNICAL auto-resolves UPHOLD', async () => {
    const tx = await confirmTx(4);
    // Insert a recon run + STATUS_MISMATCH break referencing this tx.
    const runId = uuidv7();
    await query(
      `INSERT INTO reconciliation_runs (id, participant_code, currency, operating_date, run_type, state, total_compared, total_matched, total_breaks)
       VALUES ($1, $2, 'GHS', current_date, 'EOD', 'completed', 1, 0, 1)`,
      [runId, BENE]
    );
    await query(
      `INSERT INTO reconciliation_breaks (id, run_id, break_type, rail_transaction_id, amount_minor, currency, rail_state, participant_state)
       VALUES ($1, $2, 'STATUS_MISMATCH', $3, $4, 'GHS', 'CONFIRMED', 'unknown')`,
      [uuidv7(), runId, tx.id, tx.amount_value]
    );

    const { caseRow } = await fileAndProcess({
      txId: tx.id,
      reasonCode: REASON_CODES.TECHNICAL,
      customerRef: 'CUST-TECH'
    });
    expect(caseRow.state).toBe(STATES.AUTO_RESOLVED);
    expect(caseRow.outcome).toBe('UPHOLD');
    const decision = await disputesDecisionService.findByCase(caseRow.case_number);
    expect(decision.rationale_code).toBe('AUTO_TECHNICAL_RECON_BREAK');
  });
});

describe('disputes — auto-resolver: r-wrong-beneficiary', () => {
  it('CoP no-match audit before tx → WRONG_BENEFICIARY auto-resolves REJECT', async () => {
    const tx = await confirmTx(5);
    // Resolve beneficiary account UUID and write a cop.executed audit event.
    const acct = await query(
      `SELECT id FROM accounts WHERE participant_code = $1 AND account_number = $2 LIMIT 1`,
      [BENE, '0234000001']
    );
    const beneAcctId = acct.rows[0].id;
    // Audit event with payload.score = 'no-match' for originator participant,
    // timestamp before transaction.
    await query(`UPDATE transactions SET created_at = now() + interval '1 minute' WHERE id = $1`, [tx.id]);
    // Use auditService.record so the chain hash + day are filled in.
    await db.withTransaction((c) =>
      auditService.record(c, {
        actorType: 'system',
        eventType: 'cop.executed',
        resourceType: 'account',
        resourceId: beneAcctId,
        payload: { score: 'no-match', similarity: 0.55, participantCode: ORIG }
      })
    );

    const { caseRow } = await fileAndProcess({
      txId: tx.id,
      reasonCode: REASON_CODES.WRONG_BENEFICIARY,
      customerRef: 'CUST-COP'
    });
    expect(caseRow.state).toBe(STATES.AUTO_RESOLVED);
    expect(caseRow.outcome).toBe('REJECT');
    const decision = await disputesDecisionService.findByCase(caseRow.case_number);
    expect(decision.rationale_code).toBe('AUTO_WRONG_BENEFICIARY_COP_OVERRIDE');
  });

  it('no CoP no-match audit → WRONG_BENEFICIARY falls through to manual', async () => {
    const tx = await confirmTx(6);
    const { caseRow } = await fileAndProcess({
      txId: tx.id,
      reasonCode: REASON_CODES.WRONG_BENEFICIARY,
      customerRef: 'CUST-WB-MANUAL'
    });
    expect(caseRow.state).toBe(STATES.EVIDENCE_PENDING);
  });
});

describe('disputes — auto-resolver: r-fraud', () => {
  it('completed fast-track-reversal → FRAUD auto-resolves UPHOLD', async () => {
    const tx = await confirmTx(7);
    // Invoke a fast-track and confirm, leaving it in 'completed' state.
    const ftrInvoke = await fastTrackReversalService.invoke({
      originalTransactionId: tx.id,
      evidence: { source: 'unit-test' },
      reasonCode: 'FRAD',
      invokedBy: null,
      victimParticipant: ORIG
    });
    expect(ftrInvoke.ftr.state).toBe('frozen');
    await fastTrackReversalService.confirmReversal({ id: ftrInvoke.ftr.id, confirmedBy: null });

    // After the fast-track completes, the tx is REVERSED. Disputes accept
    // both CONFIRMED and REVERSED, so the file goes through.
    const { caseRow } = await fileAndProcess({
      txId: tx.id,
      reasonCode: REASON_CODES.FRAUD,
      customerRef: 'CUST-FT-DONE'
    });
    expect(caseRow.state).toBe(STATES.AUTO_RESOLVED);
    expect(caseRow.outcome).toBe('UPHOLD');
    const decision = await disputesDecisionService.findByCase(caseRow.case_number);
    expect(decision.rationale_code).toBe('AUTO_FRAUD_FASTTRACK_COMPLETED');
  });

  it('no fast-track → FRAUD falls through to EVIDENCE_PENDING', async () => {
    const tx = await confirmTx(8);
    const { caseRow } = await fileAndProcess({
      txId: tx.id,
      reasonCode: REASON_CODES.FRAUD,
      customerRef: 'CUST-FT-NONE'
    });
    expect(caseRow.state).toBe(STATES.EVIDENCE_PENDING);
  });
});

describe('disputes — manual decision', () => {
  const advanceToAdjudicating = async (caseRow) => {
    // Force the case past EVIDENCE_PENDING by expiring the window.
    await query(
      `UPDATE dispute_cases SET evidence_pending_until = now() - interval '1 hour' WHERE id = $1`,
      [caseRow.id]
    );
    await disputesEvidenceService.expireWindowAndAdvance(caseRow.id);
  };

  it('valid manual decision UPHOLD transitions to UPHELD', async () => {
    const tx = await confirmTx(10);
    const { caseRow } = await fileAndProcess({
      txId: tx.id,
      reasonCode: REASON_CODES.GOODS_NOT_RECEIVED,
      customerRef: 'CUST-M1'
    });
    await advanceToAdjudicating(caseRow);
    const r = await disputesDecisionService.decideManually({
      caseNumber: caseRow.case_number,
      outcome: 'UPHOLD',
      rationaleCode: 'EVIDENCE_FAVORS_FILER',
      rationaleNotes: 'filer provided receipt + tracking',
      decidedByUser: null
    });
    expect(r.case.state).toBe(STATES.UPHELD);
    expect(r.decision.decision_type).toBe('MANUAL');
  });

  it('rejects an invalid rationale code', async () => {
    const tx = await confirmTx(11);
    const { caseRow } = await fileAndProcess({
      txId: tx.id,
      reasonCode: REASON_CODES.GOODS_NOT_RECEIVED,
      customerRef: 'CUST-M2'
    });
    await advanceToAdjudicating(caseRow);
    await expect(
      disputesDecisionService.decideManually({
        caseNumber: caseRow.case_number,
        outcome: 'UPHOLD',
        rationaleCode: 'NOT_A_REAL_CODE',
        decidedByUser: null
      })
    ).rejects.toThrow(/unknown rationale code/);
  });

  it('PARTIAL outcome requires outcomeAmountMinor in (0, full)', async () => {
    const tx = await confirmTx(12);
    const { caseRow } = await fileAndProcess({
      txId: tx.id,
      reasonCode: REASON_CODES.GOODS_NOT_RECEIVED,
      customerRef: 'CUST-M3'
    });
    await advanceToAdjudicating(caseRow);
    await expect(
      disputesDecisionService.decideManually({
        caseNumber: caseRow.case_number,
        outcome: 'PARTIAL',
        rationaleCode: 'EVIDENCE_FAVORS_FILER',
        decidedByUser: null
      })
    ).rejects.toThrow(/PARTIAL outcome requires outcomeAmountMinor/);
    const r = await disputesDecisionService.decideManually({
      caseNumber: caseRow.case_number,
      outcome: 'PARTIAL',
      rationaleCode: 'EVIDENCE_FAVORS_FILER',
      outcomeAmountMinor: '10000',
      decidedByUser: null
    });
    expect(r.case.state).toBe(STATES.PARTIAL_UPHELD);
  });

  it('single-decision-per-case enforced (CONFLICT on second decide)', async () => {
    const tx = await confirmTx(13);
    const { caseRow } = await fileAndProcess({
      txId: tx.id,
      reasonCode: REASON_CODES.GOODS_NOT_RECEIVED,
      customerRef: 'CUST-M4'
    });
    await advanceToAdjudicating(caseRow);
    await disputesDecisionService.decideManually({
      caseNumber: caseRow.case_number,
      outcome: 'UPHOLD',
      rationaleCode: 'EVIDENCE_FAVORS_FILER',
      decidedByUser: null
    });
    // Second attempt — case is now UPHELD, not ADJUDICATING.
    await expect(
      disputesDecisionService.decideManually({
        caseNumber: caseRow.case_number,
        outcome: 'REJECT',
        rationaleCode: 'EVIDENCE_INSUFFICIENT',
        decidedByUser: null
      })
    ).rejects.toThrow(/decision requires state ADJUDICATING/);
  });

  it('writes dispute.decided + dispute.reversal_needed audit events', async () => {
    const tx = await confirmTx(14);
    const { caseRow } = await fileAndProcess({
      txId: tx.id,
      reasonCode: REASON_CODES.GOODS_NOT_RECEIVED,
      customerRef: 'CUST-M5'
    });
    await advanceToAdjudicating(caseRow);
    await disputesDecisionService.decideManually({
      caseNumber: caseRow.case_number,
      outcome: 'UPHOLD',
      rationaleCode: 'EVIDENCE_FAVORS_FILER',
      decidedByUser: null
    });
    const audit = await query(
      `SELECT event_type FROM audit_events WHERE resource_id = $1`,
      [caseRow.id]
    );
    const types = audit.rows.map((r) => r.event_type);
    expect(types).toContain('dispute.decided');
    expect(types).toContain('dispute.reversal_needed');
  });
});
