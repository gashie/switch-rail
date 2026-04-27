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
import { overlaysBulkService, RUN_STATES } from '../index.js';

const ORIG = 'BLK_ORIG';
const BENE = 'BLK_BENE';
let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM bulk_payment_lines`);
  await query(`DELETE FROM bulk_payment_runs`);
  await query(`DELETE FROM bulk_run_sequence`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM ledger_accounts`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'bulk-%' OR source_message_id LIKE '%:%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'bulk.%' OR event_type LIKE 'ledger.%'`);
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

const buildCsv = (rows) => {
  const header = 'originator_participant,originator_account,originator_name,beneficiary_participant,beneficiary_account,beneficiary_name,amount_minor,currency,end_to_end_id,reference,remittance';
  const body = rows.map((r) =>
    `${r.op},${r.oa},${r.on},${r.bp},${r.ba},${r.bn},${r.am},${r.ccy},${r.e2e},${r.ref || ''},${r.rem || ''}`
  ).join('\n');
  return Buffer.from(`${header}\n${body}\n`, 'utf8');
};

beforeAll(async () => {
  await cleanup();
  await onboardActive(ORIG);
  await onboardActive(BENE);
  await directoryService.register({ participantCode: ORIG, accountType: 'BANK_ACCOUNT', accountNumber: '0BO0000001', accountName: 'Originator', currency: 'GHS' });
  for (let i = 1; i <= 10; i += 1) {
    await directoryService.register({
      participantCode: BENE,
      accountType: 'BANK_ACCOUNT',
      accountNumber: `0BB000000${i}`,
      accountName: `Beneficiary ${i}`,
      currency: 'GHS'
    });
  }
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
  await query(`DELETE FROM bulk_payment_lines`);
  await query(`DELETE FROM bulk_payment_runs`);
  await query(`DELETE FROM bulk_run_sequence`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'bulk-%' OR source_message_id LIKE '%:%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'bulk.%' OR event_type LIKE 'ledger.%'`);
  await setEndpoints(ORIG, baseUrl);
  await setEndpoints(BENE, baseUrl);
});

describe('overlays-bulk — upload + processing', () => {
  it('5-line CSV uploads, runs through orchestrator, all confirmed', async () => {
    const rows = [];
    for (let i = 1; i <= 5; i += 1) {
      rows.push({
        op: ORIG, oa: '0BO0000001', on: 'Originator',
        bp: BENE, ba: `0BB000000${i}`, bn: `Beneficiary ${i}`,
        am: '100', ccy: 'GHS', e2e: `e2e-${i}`
      });
    }
    const buf = buildCsv(rows);
    const upload = await overlaysBulkService.upload({
      originatorParticipant: ORIG,
      sourceFormat: 'CSV',
      sourceFilename: 'test.csv',
      buffer: buf
    });
    expect(upload.run.total_lines).toBe(5);
    expect(upload.run.state).toBe(RUN_STATES.QUEUED);
    expect(upload.run.run_number).toMatch(/^BLK-\d{6}-000001$/);

    const result = await overlaysBulkService.runToCompletion({ runId: upload.run.id });
    expect(result.run.state).toBe(RUN_STATES.COMPLETED);
    expect(result.run.succeeded_count).toBe(5);
    expect(result.run.failed_count).toBe(0);
  });

  it('one bad line (frozen beneficiary) → PARTIAL with succeeded + failed', async () => {
    // Insert a row whose beneficiary account is frozen — orchestrator will REJECT.
    await directoryService.register({
      participantCode: BENE,
      accountType: 'BANK_ACCOUNT',
      accountNumber: '9999000003', // simulator force-rejects
      accountName: 'Frozen', currency: 'GHS'
    });
    const rows = [
      { op: ORIG, oa: '0BO0000001', on: 'Originator', bp: BENE, ba: '0BB0000001', bn: 'Bene 1', am: '100', ccy: 'GHS', e2e: 'a' },
      { op: ORIG, oa: '0BO0000001', on: 'Originator', bp: BENE, ba: '9999000003', bn: 'Frozen',  am: '100', ccy: 'GHS', e2e: 'b' },
      { op: ORIG, oa: '0BO0000001', on: 'Originator', bp: BENE, ba: '0BB0000002', bn: 'Bene 2', am: '100', ccy: 'GHS', e2e: 'c' }
    ];
    const buf = buildCsv(rows);
    const upload = await overlaysBulkService.upload({
      originatorParticipant: ORIG,
      sourceFormat: 'CSV',
      sourceFilename: 'mixed.csv',
      buffer: buf
    });
    const result = await overlaysBulkService.runToCompletion({ runId: upload.run.id });
    expect(result.run.state).toBe(RUN_STATES.PARTIAL);
    expect(result.run.succeeded_count).toBe(2);
    expect(result.run.failed_count).toBe(1);
  });

  it('idempotency: re-upload same file returns existing run', async () => {
    const rows = [
      { op: ORIG, oa: '0BO0000001', on: 'O', bp: BENE, ba: '0BB0000001', bn: 'B', am: '100', ccy: 'GHS', e2e: 'idem-x' }
    ];
    const buf = buildCsv(rows);
    const a = await overlaysBulkService.upload({ originatorParticipant: ORIG, sourceFormat: 'CSV', sourceFilename: 't.csv', buffer: buf });
    const b = await overlaysBulkService.upload({ originatorParticipant: ORIG, sourceFormat: 'CSV', sourceFilename: 't.csv', buffer: buf });
    expect(b.deduped).toBe(true);
    expect(b.run.id).toBe(a.run.id);
  });

  it('processBatch in increments yields the same final result as runToCompletion', async () => {
    const rows = [];
    for (let i = 1; i <= 3; i += 1) {
      rows.push({
        op: ORIG, oa: '0BO0000001', on: 'Originator',
        bp: BENE, ba: `0BB000000${i}`, bn: `Bene ${i}`,
        am: '100', ccy: 'GHS', e2e: `inc-${i}`
      });
    }
    const buf = buildCsv(rows);
    const upload = await overlaysBulkService.upload({
      originatorParticipant: ORIG,
      sourceFormat: 'CSV',
      sourceFilename: 'inc.csv',
      buffer: buf
    });
    await overlaysBulkService.processBatch({ runId: upload.run.id, batchSize: 2 });
    const final = await overlaysBulkService.processBatch({ runId: upload.run.id, batchSize: 2 });
    expect(final.run.state).toBe(RUN_STATES.COMPLETED);
    expect(final.run.succeeded_count).toBe(3);
  });
});
