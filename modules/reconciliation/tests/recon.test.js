import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { errorHandler } from '../../../core/http.js';
import { attachContext } from '../../../core/context.js';
import * as db from '../../../core/db.js';
import { createEnvelope } from '../../envelope/index.js';
import { participantsService } from '../../participants/index.js';
import { participantOnboardingService } from '../../participant-onboarding/index.js';
import { participantSimulatorRoutes } from '../../participant-simulator/index.js';
import { directoryService } from '../../directory/index.js';
import { cryptoKeysService } from '../../crypto-keys/index.js';
import { transactionsOrchestrator } from '../../transactions/index.js';
import {
  reconciliationService,
  reconciliationModel,
  createReconService,
  createParticipantFeedClient
} from '../index.js';

const ORIG = 'REC_O_BNK';
const BENE = 'REC_B_BNK';
let baseUrl;
let server;

const today = () => new Date().toISOString().slice(0, 10);

const cleanup = async () => {
  await query(`DELETE FROM reconciliation_breaks`);
  await query(`DELETE FROM reconciliation_runs`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM ledger_accounts`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'rcn-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'cycle.%' OR event_type LIKE 'eod.%' OR event_type LIKE 'recon.%' OR event_type LIKE 'settlement.%'`);
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
    sourceMessageId: `rcn-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `rcn-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `rcn-idem-${Date.now()}-${idx}-${Math.random()}`,
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
  await query(`DELETE FROM reconciliation_breaks`);
  await query(`DELETE FROM reconciliation_runs`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'rcn-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'recon.%' OR event_type LIKE 'settlement.%'`);
});

describe('reconciliation — identity feed (zero breaks)', () => {
  it('matches every confirmed transaction against the rail-mirror feed', async () => {
    await transactionsOrchestrator.process(buildEnv(1));
    await transactionsOrchestrator.process(buildEnv(2));

    const out = await reconciliationService.runReconciliation({
      participantCode: ORIG,
      currency: 'GHS',
      operatingDate: today(),
      runType: 'CONTINUOUS'
    });
    expect(out.run.state).toBe('completed');
    expect(out.run.total_breaks).toBe(0);
    expect(out.run.total_compared).toBeGreaterThan(0);
    expect(out.breaks.length).toBe(0);
  });
});

describe('reconciliation — break detection with stub feed', () => {
  it('flags MISSING_AT_PARTICIPANT and writes settlement.adjustment_needed audit', async () => {
    await transactionsOrchestrator.process(buildEnv(10));
    const customFeed = createParticipantFeedClient({
      db,
      overrideFetch: async () => ({ entries: [] }) // participant has nothing
    });
    const isolatedService = createReconService({
      db,
      model: reconciliationModel,
      feedClient: customFeed
    });
    const out = await isolatedService.runReconciliation({
      participantCode: ORIG,
      currency: 'GHS',
      operatingDate: today(),
      runType: 'EOD'
    });
    expect(out.run.total_breaks).toBeGreaterThan(0);
    expect(out.breaks.every((b) => b.break_type === 'MISSING_AT_PARTICIPANT')).toBe(true);
    const audit = await query(
      `SELECT count(*)::int AS n FROM audit_events WHERE event_type = 'settlement.adjustment_needed'`
    );
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it('flags AMOUNT_MISMATCH when feed reports a different amount', async () => {
    const r = await transactionsOrchestrator.process(buildEnv(20));
    const customFeed = createParticipantFeedClient({
      db,
      overrideFetch: async () => ({
        entries: [{
          ref: r.transaction.id,
          endToEndId: r.transaction.end_to_end_id,
          amountMinor: '99999', // wrong
          currency: 'GHS',
          state: 'credited'
        }]
      })
    });
    const svc = createReconService({ db, model: reconciliationModel, feedClient: customFeed });
    const out = await svc.runReconciliation({
      participantCode: ORIG,
      currency: 'GHS',
      operatingDate: today(),
      runType: 'CONTINUOUS'
    });
    expect(out.breaks.some((b) => b.break_type === 'AMOUNT_MISMATCH')).toBe(true);
  });

  it('flags MISSING_AT_RAIL when feed reports a phantom transaction', async () => {
    const customFeed = createParticipantFeedClient({
      db,
      overrideFetch: async () => ({
        entries: [{
          ref: '00000000-0000-7000-8000-000000000099',
          amountMinor: '500',
          currency: 'GHS',
          state: 'credited'
        }]
      })
    });
    const svc = createReconService({ db, model: reconciliationModel, feedClient: customFeed });
    const out = await svc.runReconciliation({
      participantCode: ORIG,
      currency: 'GHS',
      operatingDate: today(),
      runType: 'CONTINUOUS'
    });
    expect(out.breaks.some((b) => b.break_type === 'MISSING_AT_RAIL')).toBe(true);
  });
});

describe('reconciliation — break resolution', () => {
  it('resolveBreak transitions resolution state and writes audit', async () => {
    await transactionsOrchestrator.process(buildEnv(30));
    const customFeed = createParticipantFeedClient({
      db,
      overrideFetch: async () => ({ entries: [] })
    });
    const svc = createReconService({ db, model: reconciliationModel, feedClient: customFeed });
    const out = await svc.runReconciliation({
      participantCode: ORIG,
      currency: 'GHS',
      operatingDate: today(),
      runType: 'CONTINUOUS'
    });
    const [b] = out.breaks;
    const resolved = await reconciliationService.resolveBreak({
      id: b.id,
      resolution: 'operator_resolved',
      notes: 'phase-5 test resolution'
    });
    expect(resolved.resolution).toBe('operator_resolved');
    expect(resolved.notes).toContain('phase-5 test resolution');
  });
});
