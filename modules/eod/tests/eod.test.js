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
import { eodService } from '../index.js';

const ORIG = 'EOD_ORIG';
const BENE = 'EOD_BENE';
let baseUrl;
let server;

const today = () => new Date().toISOString().slice(0, 10);

const cleanup = async () => {
  await query(`DELETE FROM settlement_statements`);
  await query(`DELETE FROM operating_days`);
  await query(`DELETE FROM settlement_cycle_movements`);
  await query(`DELETE FROM settlement_cycles`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM ledger_accounts`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'eod-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'cycle.%' OR event_type LIKE 'eod.%'`);
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

const setBeneEndpoints = async (code, base) => {
  await query(
    `UPDATE participants SET endpoints = $2::jsonb, updated_at = now() WHERE code = $1`,
    [code, JSON.stringify({
      credit_leg: `${base}/simulator/${code}/credit-leg`,
      status_check: `${base}/simulator/${code}/status-check`,
      reversal: `${base}/simulator/${code}/reversal`
    })]
  );
};

const buildEnv = (idx) =>
  createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'REST',
    sourceMessageId: `eod-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `eod-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `eod-idem-${Date.now()}-${idx}-${Math.random()}`,
    originator: { participantCode: ORIG, accountId: '0123000001', accountType: 'BANK_ACCOUNT', name: 'Originator' },
    beneficiary: { participantCode: BENE, accountId: '0234000001', accountType: 'BANK_ACCOUNT', name: 'Beneficiary' },
    amount: { value: '15000', currency: 'GHS' }
  });

beforeAll(async () => {
  await cleanup();
  await onboardActive(ORIG);
  await onboardActive(BENE);
  await directoryService.register({ participantCode: ORIG, accountType: 'BANK_ACCOUNT', accountNumber: '0123000001', accountName: 'Originator', currency: 'GHS' });
  await directoryService.register({ participantCode: BENE, accountType: 'BANK_ACCOUNT', accountNumber: '0234000001', accountName: 'Beneficiary', currency: 'GHS' });
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
  await query(`DELETE FROM settlement_statements`);
  await query(`DELETE FROM operating_days`);
  await query(`DELETE FROM settlement_cycle_movements`);
  await query(`DELETE FROM settlement_cycles`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'eod-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'cycle.%' OR event_type LIKE 'eod.%'`);
});

describe('eod — operating day lifecycle', () => {
  it('ensureToday opens today as OPEN', async () => {
    const day = await eodService.ensureToday();
    expect(day.state).toBe('OPEN');
  });

  it('ensureToday is idempotent', async () => {
    const a = await eodService.ensureToday();
    const b = await eodService.ensureToday();
    expect(a.id).toBe(b.id);
  });
});

describe('eod — cutover', () => {
  it('runs an EOD cycle, signs a statement per participant, closes the day, opens the next', async () => {
    await eodService.ensureToday();
    // Two confirmed transactions create activity for both participants.
    await transactionsOrchestrator.process(buildEnv(1));
    await transactionsOrchestrator.process(buildEnv(2));

    const result = await eodService.cutover({
      operatingDate: today(),
      confirmation: 'eod-test-cutover'
    });
    expect(result.day.state).toBe('CLOSED');
    expect(result.day.closing_journal_seq).toBeTruthy();
    expect(result.day.closing_chain_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.cycles.length).toBe(1);
    expect(result.statements.length).toBe(2);
    expect(result.nextDay.state).toBe('OPEN');
  });

  it('rejects calls without a confirmation token', async () => {
    await eodService.ensureToday();
    await expect(
      eodService.cutover({ operatingDate: today() })
    ).rejects.toThrow(/confirmation token/);
  });

  it('rejects re-running on a CLOSED day', async () => {
    await eodService.ensureToday();
    await transactionsOrchestrator.process(buildEnv(10));
    await eodService.cutover({ operatingDate: today(), confirmation: 'eod-1' });
    await expect(
      eodService.cutover({ operatingDate: today(), confirmation: 'eod-2' })
    ).rejects.toThrow(/already CLOSED/);
  });

  it('signs statements that verify against the rail key', async () => {
    await eodService.ensureToday();
    await transactionsOrchestrator.process(buildEnv(20));
    await eodService.cutover({ operatingDate: today(), confirmation: 'eod-verify' });
    const statements = await eodService.listStatements(today());
    expect(statements.length).toBeGreaterThanOrEqual(2);
    for (const stmt of statements) {
      const result = await eodService.verify({
        payload: stmt.payload,
        signature: stmt.signature_b64,
        kid: stmt.signature_kid
      });
      expect(result.valid).toBe(true);
    }
  });

  it('verify rejects a tampered statement payload', async () => {
    await eodService.ensureToday();
    await transactionsOrchestrator.process(buildEnv(30));
    await eodService.cutover({ operatingDate: today(), confirmation: 'eod-tamper' });
    const [stmt] = await eodService.listStatements(today());
    const tampered = { ...stmt.payload, totalCreditsMinor: '99999999' };
    const result = await eodService.verify({
      payload: tampered,
      signature: stmt.signature_b64,
      kid: stmt.signature_kid
    });
    expect(result.valid).toBe(false);
  });
});
