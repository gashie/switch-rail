import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { errorHandler } from '../../../core/http.js';
import { attachContext } from '../../../core/context.js';
import { canonicalJsonBytes } from '../../../core/json.js';
import { createEnvelope } from '../../envelope/index.js';
import { participantsService } from '../../participants/index.js';
import { participantOnboardingService } from '../../participant-onboarding/index.js';
import { participantSimulatorRoutes } from '../../participant-simulator/index.js';
import { directoryService } from '../../directory/index.js';
import { cryptoKeysService } from '../../crypto-keys/index.js';
import { transactionsOrchestrator } from '../../transactions/index.js';
import {
  disputesService,
  disputesEvidenceService,
  REASON_CODES,
  STATES
} from '../index.js';
import { _resetRunners } from '../auto-resolver.js';

const ORIG = 'D7E_BANK_O';
const BENE = 'D7E_BANK_B';
let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM dispute_evidence`);
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
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'd7e-%'`);
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

const buildEnv = (idx) =>
  createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'REST',
    sourceMessageId: `d7e-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `d7e-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `d7e-idem-${Date.now()}-${idx}-${Math.random()}`,
    originator: { participantCode: ORIG, accountId: '0123000001', accountType: 'BANK_ACCOUNT', name: 'Originator' },
    beneficiary: { participantCode: BENE, accountId: '0234000001', accountType: 'BANK_ACCOUNT', name: 'Beneficiary' },
    amount: { value: '15000', currency: 'GHS' }
  });

const confirmTx = async (idx) => {
  await ensureBeneAccount('0234000001');
  const env = buildEnv(idx);
  const r = await transactionsOrchestrator.process(env);
  if (r.transaction.state !== 'CONFIRMED') {
    throw new Error(`expected CONFIRMED, got ${r.transaction.state}`);
  }
  return r.transaction;
};

const filePending = async (txId, customerRef = 'CUST-EV') => {
  const filed = await disputesService.file({
    transactionId: txId,
    reasonCode: REASON_CODES.GOODS_NOT_RECEIVED,
    filingParticipant: ORIG,
    filingUserRef: customerRef,
    verificationFingerprint: fingerprint(customerRef)
  });
  await disputesService.processFiled(filed.id);
  return disputesService.findByCaseNumber(filed.case_number);
};

const upload = (caseNumber, side, content, opts = {}) =>
  disputesEvidenceService.upload({
    caseNumber,
    side,
    uploadedByParticipant: side === 'FILER' ? ORIG : side === 'RESPONDER' ? BENE : null,
    uploadedByUser: null,
    file: {
      buffer: Buffer.from(content),
      filename: opts.filename || `${side.toLowerCase()}-evidence.txt`,
      size: Buffer.byteLength(content),
      mimeType: opts.mimeType || 'text/plain',
      evidenceType: opts.evidenceType || 'DOCUMENT'
    },
    description: opts.description || `${side} evidence`
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
  await query(`DELETE FROM dispute_evidence`);
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
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'd7e-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'dispute.%' OR event_type LIKE 'ledger.%'`);
  _resetRunners();
  await setEndpoints(BENE, baseUrl);
});

describe('disputes — evidence upload + crypto timestamping', () => {
  it('uploads from FILER and persists signed metadata + chain hash', async () => {
    const tx = await confirmTx(1);
    const c = await filePending(tx.id, 'CUST-1');
    const ev = await upload(c.case_number, 'FILER', 'invoice scan');
    expect(ev.id).toBeTruthy();
    expect(ev.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ev.rail_signature_b64).toBeTruthy();
    expect(ev.rail_signature_kid).toBeTruthy();
    expect(ev.evidence_chain_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(ev.prev_evidence_hash).toBe('');
  });

  it('signature is verifiable using the rail public key', async () => {
    const tx = await confirmTx(2);
    const c = await filePending(tx.id, 'CUST-2');
    const ev = await upload(c.case_number, 'FILER', 'voucher copy');
    const sig = await disputesEvidenceService.signaturePayloadFor(ev.id);
    const ok = await cryptoKeysService.verify({
      kid: sig.kid,
      payload: canonicalJsonBytes(sig.payload),
      signature: sig.signature
    });
    expect(ok).toBe(true);
  });

  it('chain links across two uploads', async () => {
    const tx = await confirmTx(3);
    const c = await filePending(tx.id, 'CUST-3');
    const e1 = await upload(c.case_number, 'FILER', 'A');
    const e2 = await upload(c.case_number, 'FILER', 'B', { filename: 'b.txt' });
    expect(e2.prev_evidence_hash).toBe(e1.evidence_chain_hash);
    const v = await disputesEvidenceService.verifyChain(c.case_number);
    expect(v.ok).toBe(true);
    expect(v.count).toBe(2);
  });

  it('verifyChain detects tampering when content_sha256 mutated', async () => {
    const tx = await confirmTx(4);
    const c = await filePending(tx.id, 'CUST-4');
    const e = await upload(c.case_number, 'FILER', 'tamper bait');
    await query(
      `UPDATE dispute_evidence SET content_sha256 = $1 WHERE id = $2`,
      ['0'.repeat(64), e.id]
    );
    const v = await disputesEvidenceService.verifyChain(c.case_number);
    expect(v.ok).toBe(false);
    expect(v.brokenAtId).toBe(e.id);
  });
});

describe('disputes — auto-progress on both-sides evidence', () => {
  it('two-sided evidence advances EVIDENCE_PENDING -> ADJUDICATING', async () => {
    const tx = await confirmTx(5);
    const c = await filePending(tx.id, 'CUST-5');
    expect(c.state).toBe(STATES.EVIDENCE_PENDING);
    await upload(c.case_number, 'FILER', 'filer doc');
    const intermediate = await disputesService.findByCaseNumber(c.case_number);
    expect(intermediate.state).toBe(STATES.EVIDENCE_PENDING);
    await upload(c.case_number, 'RESPONDER', 'responder doc');
    const advanced = await disputesService.findByCaseNumber(c.case_number);
    expect(advanced.state).toBe(STATES.ADJUDICATING);
    expect(advanced.adjudicating_at).toBeTruthy();
  });

  it('window expiry advances EVIDENCE_PENDING -> ADJUDICATING via expireWindowAndAdvance', async () => {
    const tx = await confirmTx(6);
    const c = await filePending(tx.id, 'CUST-6');
    // Backdate the deadline.
    await query(
      `UPDATE dispute_cases SET evidence_pending_until = now() - interval '1 hour' WHERE id = $1`,
      [c.id]
    );
    const r = await disputesEvidenceService.expireWindowAndAdvance(c.id);
    expect(r.advanced).toBe(true);
    expect(r.case.state).toBe(STATES.ADJUDICATING);
  });

  it('expireWindowAndAdvance is a no-op when deadline still in future', async () => {
    const tx = await confirmTx(7);
    const c = await filePending(tx.id, 'CUST-7');
    const r = await disputesEvidenceService.expireWindowAndAdvance(c.id);
    expect(r.advanced).toBe(false);
  });
});

describe('disputes — evidence list/filter', () => {
  it('lists evidence per case with optional side filter', async () => {
    const tx = await confirmTx(8);
    const c = await filePending(tx.id, 'CUST-8');
    await upload(c.case_number, 'FILER', 'one');
    await upload(c.case_number, 'RESPONDER', 'two');
    const all = await disputesEvidenceService.listForCase({ caseNumber: c.case_number });
    expect(all.items.length).toBe(2);
    const filerOnly = await disputesEvidenceService.listForCase({ caseNumber: c.case_number, side: 'FILER' });
    expect(filerOnly.items.length).toBe(1);
    expect(filerOnly.items[0].side).toBe('FILER');
  });
});

describe('disputes — evidence in non-eligible state rejected', () => {
  it('refuses upload on a SETTLED/REJECTED case', async () => {
    const tx = await confirmTx(9);
    const c = await filePending(tx.id, 'CUST-9');
    // Force-terminate via kill.
    await disputesService.operatorKill({ id: c.id, reason: 'cleanup', killedByUser: null });
    await expect(
      upload(c.case_number, 'FILER', 'late entry')
    ).rejects.toThrow(/not allowed/);
  });
});
