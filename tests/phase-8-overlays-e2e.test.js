// Phase 8 end-to-end: exercises all 8 overlays back-to-back through the
// orchestrator (or, for escrow's rail-internal flow, through ledgerService)
// to prove they compose cleanly.

import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, query } from '../core/db.js';
import { errorHandler } from '../core/http.js';
import { attachContext } from '../core/context.js';
import { participantsService } from '../modules/participants/index.js';
import { participantOnboardingService } from '../modules/participant-onboarding/index.js';
import { participantSimulatorRoutes } from '../modules/participant-simulator/index.js';
import { directoryService } from '../modules/directory/index.js';
import { cryptoKeysService } from '../modules/crypto-keys/index.js';
import { transactionsOrchestrator, transactionsService } from '../modules/transactions/index.js';
import { createEnvelope } from '../modules/envelope/index.js';
import { overlaysR2pService } from '../modules/overlays-r2p/index.js';
import { overlaysQrService } from '../modules/overlays-qr/index.js';
import { overlaysMandatesService } from '../modules/overlays-mandates/index.js';
import { overlaysBulkService } from '../modules/overlays-bulk/index.js';
import { overlaysCashoutService } from '../modules/overlays-cashout/index.js';
import { overlaysRefundsService } from '../modules/overlays-refunds/index.js';
import { overlaysEscrowService } from '../modules/overlays-escrow/index.js';
import { overlaysSplitService } from '../modules/overlays-split/index.js';

const A = 'P8E_BANK_A';
const B = 'P8E_BANK_B';
const C = 'P8E_BANK_C';
const AGT = 'P8E_AGENT';
const PARTICIPANTS = [A, B, C, AGT];

let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM split_legs`);
  await query(`DELETE FROM split_instructions`);
  await query(`DELETE FROM split_sequence`);
  await query(`DELETE FROM escrow_holds`);
  await query(`DELETE FROM escrow_sequence`);
  await query(`DELETE FROM refunds`);
  await query(`DELETE FROM refund_sequence`);
  await query(`DELETE FROM cashout_requests`);
  await query(`DELETE FROM cashout_request_sequence`);
  await query(`DELETE FROM bulk_payment_lines`);
  await query(`DELETE FROM bulk_payment_runs`);
  await query(`DELETE FROM bulk_run_sequence`);
  await query(`DELETE FROM mandate_debits`);
  await query(`DELETE FROM mandates`);
  await query(`DELETE FROM mandate_sequence`);
  await query(`DELETE FROM qr_codes`);
  await query(`DELETE FROM r2p_requests`);
  await query(`DELETE FROM r2p_request_sequence`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions WHERE participant_code = ANY($1)`, [PARTICIPANTS]);
  await query(`DELETE FROM ledger_accounts`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'p8e-%' OR source_message_id LIKE 'r2p-%' OR source_message_id LIKE 'qr-%' OR source_message_id LIKE 'mnd-%' OR source_message_id LIKE 'bulk-%' OR source_message_id LIKE 'csh-%' OR source_message_id LIKE 'ref-%' OR source_message_id LIKE 'spl-%'`);
  await query(`DELETE FROM accounts WHERE participant_code = ANY($1)`, [PARTICIPANTS]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code = ANY($1))`, [PARTICIPANTS]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code = ANY($1))`, [PARTICIPANTS]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id = ANY($1)`, [PARTICIPANTS]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'r2p.%' OR event_type LIKE 'qr.%' OR event_type LIKE 'mandate.%' OR event_type LIKE 'bulk.%' OR event_type LIKE 'cashout.%' OR event_type LIKE 'refund.%' OR event_type LIKE 'escrow.%' OR event_type LIKE 'split.%' OR event_type LIKE 'ledger.%'`);
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

beforeAll(async () => {
  await cleanup();
  for (const c of PARTICIPANTS) await onboardActive(c);
  await directoryService.register({ participantCode: A, accountType: 'BANK_ACCOUNT', accountNumber: '0AA0000001', accountName: 'A acct', currency: 'GHS' });
  await directoryService.register({ participantCode: B, accountType: 'BANK_ACCOUNT', accountNumber: '0BB0000001', accountName: 'B acct', currency: 'GHS' });
  await directoryService.register({ participantCode: B, accountType: 'BANK_ACCOUNT', accountNumber: '0BB0000002', accountName: 'B acct2', currency: 'GHS' });
  await directoryService.register({ participantCode: C, accountType: 'BANK_ACCOUNT', accountNumber: '0CC0000001', accountName: 'C acct', currency: 'GHS' });
  await directoryService.register({ participantCode: AGT, accountType: 'AGENT_FLOAT', accountNumber: '0AGT000001', accountName: 'Agent Float', currency: 'GHS' });
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
  for (const c of PARTICIPANTS) await setEndpoints(c, baseUrl);
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await cleanup();
  await closePool();
});

describe('phase-8 e2e — every overlay composes cleanly', () => {
  it('R2P: request → authorize → orchestrator → PAID', async () => {
    const r = await overlaysR2pService.create({
      requesterParticipant: B,
      requesterAccountNumber: '0BB0000001',
      payerParticipant: A,
      amountMinor: '1000',
      currency: 'GHS',
      reason: 'invoice'
    });
    const out = await overlaysR2pService.authorize({
      requestNumber: r.request_number,
      payerAccountNumber: '0AA0000001',
      payerName: 'Kofi A'
    });
    expect(out.transactionState).toBe('CONFIRMED');
    expect(out.request.state).toBe('PAID');
  });

  it('QR static: encode → decode → pay → tx CONFIRMED', async () => {
    const qr = await overlaysQrService.createStatic({
      merchantParticipant: B,
      merchantAccountNumber: '0BB0000001',
      mcc: '5411',
      merchantName: 'B STORE'
    });
    const out = await overlaysQrService.pay({
      encodedPayload: qr.encoded_payload,
      payerParticipant: A,
      payerAccountNumber: '0AA0000001',
      payerName: 'Ama A',
      amountMinorOverride: '700'
    });
    expect(out.transaction.state).toBe('CONFIRMED');
    expect(out.qr.state).toBe('ACTIVE');
  });

  it('QR dynamic: pays once, second attempt rejected', async () => {
    const qr = await overlaysQrService.createDynamic({
      merchantParticipant: B,
      merchantAccountNumber: '0BB0000001',
      mcc: '5411',
      amountMinor: '1500',
      merchantName: 'B STORE'
    });
    const out1 = await overlaysQrService.pay({
      encodedPayload: qr.encoded_payload,
      payerParticipant: A,
      payerAccountNumber: '0AA0000001',
      payerName: 'Ama A'
    });
    expect(out1.transaction.state).toBe('CONFIRMED');
    await expect(
      overlaysQrService.pay({
        encodedPayload: qr.encoded_payload,
        payerParticipant: A,
        payerAccountNumber: '0AA0000001',
        payerName: 'Ama A'
      })
    ).rejects.toThrow(/CONSUMED/);
  });

  it('Mandate: AS_PRESENTED debit → tx CONFIRMED', async () => {
    const m = await overlaysMandatesService.create({
      payerParticipant: A,
      payerAccountNumber: '0AA0000001',
      payeeParticipant: B,
      payeeAccountNumber: '0BB0000001',
      perDebitCapMinor: '5000',
      currency: 'GHS',
      frequency: 'AS_PRESENTED',
      reference: 'subscription'
    });
    const r = await overlaysMandatesService.presentDebit({
      mandateId: m.id,
      presentedAmountMinor: '500'
    });
    expect(r.ok).toBe(true);
    expect(r.transaction.state).toBe('CONFIRMED');
  });

  it('Bulk: 3-line CSV → 3 confirmed', async () => {
    const header = 'originator_participant,originator_account,originator_name,beneficiary_participant,beneficiary_account,beneficiary_name,amount_minor,currency,end_to_end_id,reference,remittance';
    const body = [
      `${A},0AA0000001,A,${B},0BB0000001,B1,200,GHS,bulk-e2e-1,,`,
      `${A},0AA0000001,A,${B},0BB0000002,B2,200,GHS,bulk-e2e-2,,`,
      `${A},0AA0000001,A,${C},0CC0000001,C1,200,GHS,bulk-e2e-3,,`
    ].join('\n');
    const buf = Buffer.from(`${header}\n${body}\n`, 'utf8');
    const upload = await overlaysBulkService.upload({
      originatorParticipant: A,
      sourceFormat: 'CSV',
      sourceFilename: 'p8e.csv',
      buffer: buf
    });
    const result = await overlaysBulkService.runToCompletion({ runId: upload.run.id });
    expect(result.run.state).toBe('COMPLETED');
    expect(result.run.succeeded_count).toBe(3);
  });

  it('Cashout: initiate → authorize → complete with OTP → tx CONFIRMED', async () => {
    const r = await overlaysCashoutService.initiate({
      customerParticipant: A,
      customerAccountNumber: '0AA0000001',
      agentParticipant: AGT,
      agentFloatAccountNumber: '0AGT000001',
      amountMinor: '300',
      currency: 'GHS',
      expiresInMinutes: 5
    });
    await overlaysCashoutService.authorize({ requestNumber: r.request_number });
    const out = await overlaysCashoutService.complete({
      requestNumber: r.request_number,
      otp: r.agent_otp,
      customerName: 'Kofi A'
    });
    expect(out.transaction.state).toBe('CONFIRMED');
    expect(out.request.state).toBe('COMPLETED');
  });

  it('Refund: full refund of CONFIRMED tx', async () => {
    // First confirm a fresh tx.
    const env = createEnvelope({
      msgType: 'CRDT_TRF',
      sourceFormat: 'REST',
      sourceMessageId: `p8e-ref-orig-${Date.now()}-${Math.random()}`,
      endToEndId: `p8e-ref-orig-${Date.now()}`,
      idempotencyKey: `p8e-ref-orig-${Date.now()}-${Math.random()}`,
      originator: { participantCode: A, accountId: '0AA0000001', accountType: 'BANK_ACCOUNT', name: 'A' },
      beneficiary: { participantCode: B, accountId: '0BB0000001', accountType: 'BANK_ACCOUNT', name: 'B' },
      amount: { value: '2000', currency: 'GHS' }
    });
    const r = await transactionsOrchestrator.process(env);
    expect(r.transaction.state).toBe('CONFIRMED');
    const out = await overlaysRefundsService.initiate({
      originalTransactionId: r.transaction.id,
      initiatedByParticipant: B,
      amountMinor: '2000',
      reasonCode: 'CUSTOMER_REQUEST'
    });
    expect(out.refund.state).toBe('COMPLETED');
    expect(out.transaction.state).toBe('CONFIRMED');
  });

  it('Escrow: hold → BOTH_SIGNATURES release → RELEASED', async () => {
    const e = await overlaysEscrowService.create({
      payerParticipant: A,
      payerAccountNumber: '0AA0000001',
      payerName: 'Kofi A',
      payeeParticipant: B,
      payeeAccountNumber: '0BB0000001',
      amountMinor: '4000',
      currency: 'GHS',
      releaseCondition: 'BOTH_SIGNATURES'
    });
    expect(e.state).toBe('HELD');
    await overlaysEscrowService.sign({ escrowNumber: e.escrow_number, signedBy: 'PAYER' });
    const final = await overlaysEscrowService.sign({ escrowNumber: e.escrow_number, signedBy: 'PAYEE' });
    expect(final.state).toBe('RELEASED');
  });

  it('Split: 4-way split all CONFIRMED atomically', async () => {
    const out = await overlaysSplitService.create({
      payerParticipant: A,
      payerAccountNumber: '0AA0000001',
      payerName: 'Kofi A',
      totalAmountMinor: '1000',
      currency: 'GHS',
      reference: 'order-e2e',
      legs: [
        { beneficiaryParticipant: B, beneficiaryAccountNumber: '0BB0000001', beneficiaryName: 'Marketplace', amountMinor: '700' },
        { beneficiaryParticipant: B, beneficiaryAccountNumber: '0BB0000002', beneficiaryName: 'Rider',       amountMinor: '200' },
        { beneficiaryParticipant: C, beneficiaryAccountNumber: '0CC0000001', beneficiaryName: 'Platform',    amountMinor: '50' },
        { beneficiaryParticipant: C, beneficiaryAccountNumber: '0CC0000001', beneficiaryName: 'Tax',         amountMinor: '50' }
      ]
    });
    expect(out.split.state).toBe('COMPLETED');
    expect(out.legs.every((r) => r.ok)).toBe(true);
    void transactionsService; // touch import so lint doesn't grumble
  });
});
