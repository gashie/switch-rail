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
import { transactionReceiptsService, PARTIES } from '../index.js';

const ORIG = 'RCT_BANK_O';
const BENE = 'RCT_BANK_B';
let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'rct-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%'`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participants WHERE code IN ($1,$2)`, [ORIG, BENE]);
};

const onboardActive = async (code) => {
  await participantsService.create({
    code,
    name: code,
    legalName: `${code} PLC`,
    type: 'BANK',
    countryCode: 'GH'
  });
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

const setBeneEndpoints = async (code, base) => {
  await query(
    `UPDATE participants SET endpoints = $2::jsonb, updated_at = now() WHERE code = $1`,
    [
      code,
      JSON.stringify({
        credit_leg: `${base}/simulator/${code}/credit-leg`,
        status_check: `${base}/simulator/${code}/status-check`,
        reversal: `${base}/simulator/${code}/reversal`
      })
    ]
  );
};

const buildEnv = (beneAccount, idx) =>
  createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'REST',
    sourceMessageId: `rct-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `rct-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `rct-idem-${Date.now()}-${idx}-${Math.random()}`,
    originator: {
      participantCode: ORIG,
      accountId: '0123000001',
      accountType: 'BANK_ACCOUNT',
      name: 'Originator'
    },
    beneficiary: {
      participantCode: BENE,
      accountId: beneAccount,
      accountType: 'BANK_ACCOUNT',
      name: 'Beneficiary'
    },
    amount: { value: '15000', currency: 'GHS' }
  });

const ensureBeneAccount = async (account) => {
  await directoryService.register({
    participantCode: BENE,
    accountType: 'BANK_ACCOUNT',
    accountNumber: account,
    accountName: 'Beneficiary',
    currency: 'GHS'
  });
};

beforeAll(async () => {
  await cleanup();
  await onboardActive(ORIG);
  await onboardActive(BENE);
  await directoryService.register({
    participantCode: ORIG,
    accountType: 'BANK_ACCOUNT',
    accountNumber: '0123000001',
    accountName: 'Originator',
    currency: 'GHS'
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
  await setBeneEndpoints(BENE, baseUrl);
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await cleanup();
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM accounts WHERE participant_code = $1 AND account_number LIKE '02%'`, [BENE]);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'rct-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%'`);
});

describe('receipts — issuance via orchestrator', () => {
  it('a CONFIRMED transaction has exactly two receipts (one per party)', async () => {
    await ensureBeneAccount('0234000001');
    const env = buildEnv('0234000001', 1);
    const r = await transactionsOrchestrator.process(env);
    expect(r.transaction.state).toBe('CONFIRMED');

    const out = await transactionReceiptsService.findForTransaction(r.transaction.id);
    expect(out.found).toBe(true);
    expect(out.receipts.length).toBe(2);
    const parties = out.receipts.map((x) => x.party).sort();
    expect(parties).toEqual([...PARTIES].sort());
  });

  it('each receipt carries the correct participant_code, payload, and signature', async () => {
    await ensureBeneAccount('0234000002');
    const env = buildEnv('0234000002', 2);
    const r = await transactionsOrchestrator.process(env);

    const out = await transactionReceiptsService.findForTransaction(r.transaction.id);
    const orig = out.receipts.find((x) => x.party === 'ORIGINATOR');
    const bene = out.receipts.find((x) => x.party === 'BENEFICIARY');
    expect(orig.participant_code).toBe(ORIG);
    expect(bene.participant_code).toBe(BENE);

    expect(orig.receipt_payload.amount.value).toBe('15000');
    expect(orig.receipt_payload.amount.currency).toBe('GHS');
    expect(orig.receipt_payload.responseCode).toBe('ACSC');
    expect(orig.signature_b64).toBeTruthy();
    expect(orig.signature_kid).toBeTruthy();
    expect(orig.signature_alg).toBe('Ed25519');
  });

  it('receipt signatures verify against the rail public key', async () => {
    await ensureBeneAccount('0234000003');
    const env = buildEnv('0234000003', 3);
    const r = await transactionsOrchestrator.process(env);

    const out = await transactionReceiptsService.findForTransaction(r.transaction.id);
    for (const receipt of out.receipts) {
      const result = await transactionReceiptsService.verify({
        payload: receipt.receipt_payload,
        signature: receipt.signature_b64,
        kid: receipt.signature_kid
      });
      expect(result.valid).toBe(true);
    }
  });

  it('verify rejects a payload tampered after signing', async () => {
    await ensureBeneAccount('0234000004');
    const env = buildEnv('0234000004', 4);
    const r = await transactionsOrchestrator.process(env);

    const out = await transactionReceiptsService.findForTransaction(r.transaction.id);
    const receipt = out.receipts[0];
    const tampered = {
      ...receipt.receipt_payload,
      amount: { value: '99999999', currency: 'GHS' }
    };
    const result = await transactionReceiptsService.verify({
      payload: tampered,
      signature: receipt.signature_b64,
      kid: receipt.signature_kid
    });
    expect(result.valid).toBe(false);
  });

  it('REJECTED transactions get no receipts', async () => {
    await ensureBeneAccount('9999000002'); // AM04 — insufficient
    const env = buildEnv('9999000002', 5);
    const r = await transactionsOrchestrator.process(env);
    expect(r.transaction.state).toBe('REJECTED');

    const out = await transactionReceiptsService.findForTransaction(r.transaction.id);
    expect(out.receipts.length).toBe(0);
  });

  it('idempotent re-processing does not create duplicate receipts', async () => {
    await ensureBeneAccount('0234000007');
    const env = buildEnv('0234000007', 6);
    const r1 = await transactionsOrchestrator.process(env);
    const r2 = await transactionsOrchestrator.process(env);
    expect(r2.transaction.id).toBe(r1.transaction.id);
    expect(r2.deduped).toBe(true);

    const out = await transactionReceiptsService.findForTransaction(r1.transaction.id);
    expect(out.receipts.length).toBe(2);
  });
});

describe('receipts — issueReceipts guard', () => {
  it('refuses to issue receipts for a non-CONFIRMED transaction', async () => {
    await ensureBeneAccount('0234000050');
    const env = buildEnv('0234000050', 50);
    // Ingest only — leaves transaction in RECEIVED.
    await import('../../envelope/index.js').then((m) => m.envelopeService.ingest(env));
    const tx = await transactionsService.ingestFromEnvelope(env);
    await expect(
      transactionReceiptsService.issueReceipts(tx)
    ).rejects.toThrow(/cannot issue receipts/);
  });
});

describe('receipts — listing for participant', () => {
  it('returns receipts for both originator and beneficiary participants', async () => {
    await ensureBeneAccount('0234000080');
    const env = buildEnv('0234000080', 80);
    await transactionsOrchestrator.process(env);

    const origList = await transactionReceiptsService.listForParticipant(ORIG, { limit: 100, offset: 0 });
    expect(origList.total).toBeGreaterThanOrEqual(1);
    expect(origList.rows.every((r) => r.participant_code === ORIG)).toBe(true);

    const beneList = await transactionReceiptsService.listForParticipant(BENE, { limit: 100, offset: 0 });
    expect(beneList.total).toBeGreaterThanOrEqual(1);
    expect(beneList.rows.every((r) => r.participant_code === BENE)).toBe(true);
  });
});
