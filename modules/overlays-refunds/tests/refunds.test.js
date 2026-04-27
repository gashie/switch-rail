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
import { overlaysRefundsService, REFUND_STATES } from '../index.js';

const ORIG = 'REF_ORIG';
const BENE = 'REF_BENE';
let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM refunds`);
  await query(`DELETE FROM refund_sequence`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM ledger_accounts`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'ref-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'refund.%' OR event_type LIKE 'ledger.%'`);
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

const buildEnv = (idx) =>
  createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'REST',
    sourceMessageId: `ref-orig-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `ref-orig-${Date.now()}-${idx}`,
    idempotencyKey: `ref-orig-idem-${Date.now()}-${idx}-${Math.random()}`,
    originator: { participantCode: ORIG, accountId: '0RO0000001', accountType: 'BANK_ACCOUNT', name: 'Originator' },
    beneficiary: { participantCode: BENE, accountId: '0RB0000001', accountType: 'BANK_ACCOUNT', name: 'Beneficiary' },
    amount: { value: '10000', currency: 'GHS' }
  });

const confirmTx = async (idx) => {
  const env = buildEnv(idx);
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
  await directoryService.register({ participantCode: ORIG, accountType: 'BANK_ACCOUNT', accountNumber: '0RO0000001', accountName: 'Originator', currency: 'GHS' });
  await directoryService.register({ participantCode: BENE, accountType: 'BANK_ACCOUNT', accountNumber: '0RB0000001', accountName: 'Beneficiary', currency: 'GHS' });
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
  await setEndpoints(ORIG, baseUrl);
  await setEndpoints(BENE, baseUrl);
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await cleanup();
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM refunds`);
  await query(`DELETE FROM refund_sequence`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'ref-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'refund.%' OR event_type LIKE 'ledger.%'`);
  await setEndpoints(ORIG, baseUrl);
  await setEndpoints(BENE, baseUrl);
});

describe('overlays-refunds — full refund', () => {
  it('full refund of CONFIRMED tx → COMPLETED + signature verifies', async () => {
    const tx = await confirmTx(1);
    const out = await overlaysRefundsService.initiate({
      originalTransactionId: tx.id,
      initiatedByParticipant: BENE,
      amountMinor: '10000',
      reasonCode: 'CUSTOMER_REQUEST',
      reasonMessage: 'damaged goods'
    });
    expect(out.refund.state).toBe(REFUND_STATES.COMPLETED);
    expect(out.refund.refund_number).toMatch(/^REF-\d{6}-000001$/);
    expect(out.transaction.state).toBe('CONFIRMED');

    const sig = await overlaysRefundsService.linkSignaturePayload(out.refund.id);
    const ok = await cryptoKeysService.verify({
      kid: sig.kid,
      payload: canonicalJsonBytes(sig.payload),
      signature: sig.signature
    });
    expect(ok).toBe(true);
  });
});

describe('overlays-refunds — partial refunds', () => {
  it('two partial refunds totalling original amount succeed; a third partial fails', async () => {
    const tx = await confirmTx(2);
    const a = await overlaysRefundsService.initiate({
      originalTransactionId: tx.id,
      initiatedByParticipant: BENE,
      amountMinor: '5000',
      reasonCode: 'OVERCHARGE'
    });
    expect(a.refund.state).toBe(REFUND_STATES.COMPLETED);
    const b = await overlaysRefundsService.initiate({
      originalTransactionId: tx.id,
      initiatedByParticipant: BENE,
      amountMinor: '5000',
      reasonCode: 'OVERCHARGE'
    });
    expect(b.refund.state).toBe(REFUND_STATES.COMPLETED);
    await expect(
      overlaysRefundsService.initiate({
        originalTransactionId: tx.id,
        initiatedByParticipant: BENE,
        amountMinor: '1',
        reasonCode: 'OTHER'
      })
    ).rejects.toThrow(/exceed original amount/);
  });
});

describe('overlays-refunds — validation', () => {
  it('rejects when originator participant tries to initiate', async () => {
    const tx = await confirmTx(3);
    await expect(
      overlaysRefundsService.initiate({
        originalTransactionId: tx.id,
        initiatedByParticipant: ORIG,
        amountMinor: '1000',
        reasonCode: 'CUSTOMER_REQUEST'
      })
    ).rejects.toThrow(/beneficiary participant/);
  });

  it('rejects refund of non-CONFIRMED original', async () => {
    const tx = await confirmTx(4);
    await query(`UPDATE transactions SET state = 'REVERSED' WHERE id = $1`, [tx.id]);
    await expect(
      overlaysRefundsService.initiate({
        originalTransactionId: tx.id,
        initiatedByParticipant: BENE,
        amountMinor: '1000',
        reasonCode: 'CUSTOMER_REQUEST'
      })
    ).rejects.toThrow(/CONFIRMED/);
  });

  it('rejects out-of-window refund', async () => {
    const tx = await confirmTx(5);
    await query(`UPDATE transactions SET confirmed_at = now() - interval '400 days' WHERE id = $1`, [tx.id]);
    await expect(
      overlaysRefundsService.initiate({
        originalTransactionId: tx.id,
        initiatedByParticipant: BENE,
        amountMinor: '1000',
        reasonCode: 'CUSTOMER_REQUEST'
      })
    ).rejects.toThrow(/window expired/);
  });
});
