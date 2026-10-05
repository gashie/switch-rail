// Phase 7 end-to-end test. Drives a confirmed transaction through every
// dispute flow: auto-resolve UPHOLD (DUPLICATE), full manual workflow
// (GOODS_NOT_RECEIVED + evidence both sides + decision + maker-checker
// confirm), auto-resolve REJECT (WRONG_BENEFICIARY with CoP override),
// and the unauthenticated customer portal lookup.

import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, query } from '../core/db.js';
import { errorHandler } from '../core/http.js';
import { attachContext } from '../core/context.js';
import { createEnvelope } from '../modules/envelope/index.js';
import { participantsService } from '../modules/participants/index.js';
import { participantOnboardingService } from '../modules/participant-onboarding/index.js';
import { participantSimulatorRoutes } from '../modules/participant-simulator/index.js';
import { directoryService } from '../modules/directory/index.js';
import { cryptoKeysService } from '../modules/crypto-keys/index.js';
import { auditService } from '../modules/audit/index.js';
import { transactionsOrchestrator, transactionsService } from '../modules/transactions/index.js';
import { ledgerService, accountCodeFor } from '../modules/ledger/index.js';
import {
  disputesService,
  disputesEvidenceService,
  disputesDecisionService,
  disputesSettlementService,
  REASON_CODES,
  STATES,
  registerDefaultRunners,
  _resetRunners
} from '../modules/disputes/index.js';
import { uuidv7 } from '../core/uuid.js';
import * as db from '../core/db.js';

const ORIG = 'P7E_BANK_O';
const BENE = 'P7E_BANK_B';
const PARTICIPANTS = [ORIG, BENE];

let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM dispute_decisions`);
  await query(`DELETE FROM dispute_evidence`);
  await query(`DELETE FROM dispute_status_history`);
  await query(`DELETE FROM dispute_cases`);
  await query(`DELETE FROM dispute_case_sequence`);
  await query(`DELETE FROM dispute_comments`);
  await query(`DELETE FROM dispute_portal_hits`);
  await query(`DELETE FROM fast_track_reversals`);
  await query(`DELETE FROM reconciliation_breaks`);
  await query(`DELETE FROM reconciliation_runs`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions WHERE participant_code = ANY($1)`, [PARTICIPANTS]);
  await query(`DELETE FROM ledger_accounts`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'p7e-%'`);
  await query(`DELETE FROM accounts WHERE participant_code = ANY($1)`, [PARTICIPANTS]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code = ANY($1))`, [PARTICIPANTS]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code = ANY($1))`, [PARTICIPANTS]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id = ANY($1)`, [PARTICIPANTS]);
  await query(`DELETE FROM users WHERE email LIKE 'p7e-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'dispute.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'cop.%' OR event_type LIKE 'fast_track.%'`);
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
    sourceMessageId: `p7e-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `p7e-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `p7e-idem-${Date.now()}-${idx}-${Math.random()}`,
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

const upload = (caseNumber, side, content) =>
  disputesEvidenceService.upload({
    caseNumber, side,
    uploadedByParticipant: side === 'FILER' ? ORIG : BENE,
    uploadedByUser: null,
    file: {
      buffer: Buffer.from(content),
      filename: `${side.toLowerCase()}.txt`,
      size: Buffer.byteLength(content),
      mimeType: 'text/plain',
      evidenceType: 'DOCUMENT'
    },
    description: `${side} evidence`
  });

const balances = async () => {
  const reserveCode = accountCodeFor({ accountType: 'RAIL_DISPUTE_RESERVE', currency: 'GHS' });
  const origCode = accountCodeFor({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: ORIG, currency: 'GHS' });
  const beneCode = accountCodeFor({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: BENE, currency: 'GHS' });
  return {
    reserve: await ledgerService.balanceFor(reserveCode),
    originator: await ledgerService.balanceFor(origCode),
    beneficiary: await ledgerService.balanceFor(beneCode)
  };
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
  _resetRunners();
  await registerDefaultRunners();
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await cleanup();
  await closePool();
});

describe('phase-7 e2e — auto-resolve DUPLICATE → settled + originator refunded + tx REVERSED', () => {
  it('runs the full auto-DUPLICATE flow', async () => {
    const tx1 = await confirmTx(1);
    const tx2 = await confirmTx(2);
    // Force tx2 to look like a duplicate of tx1 within 60s window.
    await query(
      `UPDATE transactions SET created_at = (SELECT created_at FROM transactions WHERE id = $2) + interval '5 seconds' WHERE id = $1`,
      [tx2.id, tx1.id]
    );

    const customerRef = 'CUST-DUP-1';
    const fp = fingerprint(customerRef);
    const filed = await disputesService.file({
      transactionId: tx2.id,
      reasonCode: REASON_CODES.DUPLICATE,
      filingParticipant: ORIG,
      filingUserRef: customerRef,
      verificationFingerprint: fp
    });
    const processed = await disputesService.processFiled(filed.id);
    expect(processed.case.state).toBe(STATES.AUTO_RESOLVED);

    const before = await balances();
    const settled = await disputesSettlementService.settleAutoResolved({
      caseNumber: filed.case_number
    });
    expect(settled.case.state).toBe(STATES.SETTLED);
    const after = await balances();
    expect(after.originator - before.originator).toBe(BigInt(filed.amount_minor));

    const updatedTx = await transactionsService.findById(tx2.id);
    expect(updatedTx.state).toBe('REVERSED');
  });
});

describe('phase-7 e2e — manual GOODS_NOT_RECEIVED with maker-checker settlement', () => {
  it('runs through evidence + decision + confirm-settlement', async () => {
    const deciderId = uuidv7();
    const confirmerId = uuidv7();
    await query(
      `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, 'x', 'Decider'), ($3, $4, 'x', 'Confirmer')`,
      [deciderId, `p7e-d-${deciderId}@x.gh`, confirmerId, `p7e-c-${confirmerId}@x.gh`]
    );

    const tx = await confirmTx(3, '0234000010');
    const customerRef = 'CUST-GNR';
    const fp = fingerprint(customerRef);
    const filed = await disputesService.file({
      transactionId: tx.id,
      reasonCode: REASON_CODES.GOODS_NOT_RECEIVED,
      filingParticipant: ORIG,
      filingUserRef: customerRef,
      verificationFingerprint: fp
    });
    const processed = await disputesService.processFiled(filed.id);
    expect(processed.case.state).toBe(STATES.EVIDENCE_PENDING);

    // Both sides upload evidence; auto-progresses to ADJUDICATING.
    await upload(filed.case_number, 'FILER', 'photos and chat logs');
    await upload(filed.case_number, 'RESPONDER', 'delivery receipt');
    const adj = await disputesService.findByCaseNumber(filed.case_number);
    expect(adj.state).toBe(STATES.ADJUDICATING);

    // Decision UPHOLD by decider — case becomes UPHELD, no journal yet.
    await disputesDecisionService.decideManually({
      caseNumber: filed.case_number,
      outcome: 'UPHOLD',
      rationaleCode: 'EVIDENCE_FAVORS_FILER',
      rationaleNotes: 'photos prove non-delivery',
      decidedByUser: deciderId
    });
    const decided = await disputesService.findByCaseNumber(filed.case_number);
    expect(decided.state).toBe(STATES.UPHELD);
    expect(decided.release_journal_id).toBeNull();

    const before = await balances();
    const settled = await disputesSettlementService.confirmSettlement({
      caseNumber: filed.case_number,
      confirmedByUser: confirmerId
    });
    expect(settled.case.state).toBe(STATES.SETTLED);
    const after = await balances();
    expect(after.originator - before.originator).toBe(BigInt(filed.amount_minor));

    const updatedTx = await transactionsService.findById(tx.id);
    expect(updatedTx.state).toBe('REVERSED');

    // Audit chain.
    const audit = await query(
      `SELECT event_type FROM audit_events WHERE resource_id = $1 ORDER BY ts ASC`,
      [filed.id]
    );
    const types = audit.rows.map((r) => r.event_type);
    expect(types).toContain('dispute.filed');
    expect(types).toContain('dispute.accepted');
    expect(types).toContain('dispute.evidence_complete');
    expect(types).toContain('dispute.decided');
    expect(types).toContain('dispute.reversal_needed');
    expect(types).toContain('dispute.settled');
  });
});

describe('phase-7 e2e — WRONG_BENEFICIARY auto-rejected via CoP override', () => {
  it('CoP no-match audit before tx → REJECT auto-resolved → bene keeps funds', async () => {
    const tx = await confirmTx(4, '0234000020');
    const acct = await query(
      `SELECT id FROM accounts WHERE participant_code = $1 AND account_number = $2 LIMIT 1`,
      [BENE, '0234000020']
    );
    const beneAcctId = acct.rows[0].id;
    // Push tx forward to ensure cop.executed audit is "before" tx creation.
    await query(`UPDATE transactions SET created_at = now() + interval '1 minute' WHERE id = $1`, [tx.id]);
    await db.withTransaction((c) =>
      auditService.record(c, {
        actorType: 'system',
        eventType: 'cop.executed',
        resourceType: 'account',
        resourceId: beneAcctId,
        payload: { score: 'no-match', similarity: 0.55, participantCode: ORIG }
      })
    );

    const customerRef = 'CUST-WB';
    const filed = await disputesService.file({
      transactionId: tx.id,
      reasonCode: REASON_CODES.WRONG_BENEFICIARY,
      filingParticipant: ORIG,
      filingUserRef: customerRef,
      verificationFingerprint: fingerprint(customerRef)
    });
    const processed = await disputesService.processFiled(filed.id);
    expect(processed.case.state).toBe(STATES.AUTO_RESOLVED);
    expect(processed.case.outcome).toBe('REJECT');

    const before = await balances();
    const settled = await disputesSettlementService.settleAutoResolved({
      caseNumber: filed.case_number
    });
    expect(settled.case.state).toBe(STATES.SETTLED);
    const after = await balances();
    // Reserve releases back to beneficiary on REJECT.
    expect(after.beneficiary - before.beneficiary).toBe(BigInt(filed.amount_minor));

    const updatedTx = await transactionsService.findById(tx.id);
    expect(updatedTx.state).toBe('CONFIRMED');
  });
});

describe('phase-7 e2e — customer portal lookup', () => {
  let portalApp;
  let portalServer;
  let portalAgent;
  let caseNumber;
  let fp;

  beforeAll(async () => {
    // Stand up a separate express app whose /disputes mount uses the disputes
    // routes — this is the public surface (no auth). buildApp() does this in
    // production; we mount only the disputes routes here for hermetic test.
    const { default: disputesRoutes } = await import('../modules/disputes/routes.js');
    portalApp = express();
    portalApp.use(express.json());
    portalApp.use(attachContext);
    portalApp.use('/disputes', disputesRoutes);
    portalApp.use(errorHandler);
    portalServer = await new Promise((resolve) => {
      const s = portalApp.listen(0, () => resolve(s));
    });
    portalAgent = request.agent(portalServer);

    // File a fresh case so we have a known case_number + fingerprint.
    const tx = await confirmTx(5, '0234000030');
    const customerRef = 'CUST-PORTAL';
    fp = fingerprint(customerRef);
    const filed = await disputesService.file({
      transactionId: tx.id,
      reasonCode: REASON_CODES.GOODS_NOT_RECEIVED,
      filingParticipant: ORIG,
      filingUserRef: customerRef,
      verificationFingerprint: fp
    });
    await disputesService.processFiled(filed.id);
    caseNumber = filed.case_number;
  });

  afterAll(async () => {
    await new Promise((resolve) => portalServer?.close(resolve));
  });

  it('GET /disputes/portal/:caseNumber with correct fingerprint returns the case', async () => {
    const res = await portalAgent
      .get(`/disputes/portal/${caseNumber}`)
      .query({ fingerprint: fp });
    expect(res.status).toBe(200);
    expect(res.body.data.found).toBe(true);
    expect(res.body.data.case.caseNumber).toBe(caseNumber);
    expect(res.body.data.case.state).toBe(STATES.EVIDENCE_PENDING);
  });

  it('wrong fingerprint returns 404 found:false (no info leak)', async () => {
    const res = await portalAgent
      .get(`/disputes/portal/${caseNumber}`)
      .query({ fingerprint: 'a'.repeat(64) });
    expect(res.status).toBe(404);
    expect(res.body.data.found).toBe(false);
  });

  it('POST /disputes/portal/:caseNumber/comments persists a customer comment', async () => {
    const res = await portalAgent
      .post(`/disputes/portal/${caseNumber}/comments`)
      .send({ fingerprint: fp, comment: 'still no goods received' });
    expect(res.status).toBe(201);
    expect(res.body.data.comment.body).toBe('still no goods received');

    const lookup = await portalAgent
      .get(`/disputes/portal/${caseNumber}`)
      .query({ fingerprint: fp });
    expect(lookup.body.data.comments.length).toBeGreaterThanOrEqual(1);
  });
});
