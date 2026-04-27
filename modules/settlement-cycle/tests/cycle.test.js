import express from 'express';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { ledgerService } from '../../ledger/index.js';
import { settlementPositionsService } from '../../settlement/index.js';
import {
  settlementCycleService,
  settlementCycleModel,
  createCycleRunner,
  CYCLE_TYPES,
  buildRtgsCsv
} from '../index.js';

const ORIG = 'CY_ORIG';
const BENE = 'CY_BENE';
let baseUrl;
let server;
let runner;
let outDir;

const cleanup = async () => {
  await query(`DELETE FROM settlement_cycle_movements`);
  await query(`DELETE FROM settlement_cycles`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM ledger_accounts`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'cy-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'cycle.%'`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
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

const buildEnv = (idx, amount = '15000') =>
  createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'REST',
    sourceMessageId: `cy-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `cy-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `cy-idem-${Date.now()}-${idx}-${Math.random()}`,
    originator: { participantCode: ORIG, accountId: '0123000001', accountType: 'BANK_ACCOUNT', name: 'Originator' },
    beneficiary: { participantCode: BENE, accountId: '0234000001', accountType: 'BANK_ACCOUNT', name: 'Beneficiary' },
    amount: { value: amount, currency: 'GHS' }
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

  outDir = mkdtempSync(join(tmpdir(), 'sika-cycle-'));
  runner = createCycleRunner({ db, cycleModel: settlementCycleModel, outDir });
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await cleanup();
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM fee_schedules`);
  await query(`DELETE FROM settlement_cycle_movements`);
  await query(`DELETE FROM settlement_cycles`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'cy-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'cycle.%'`);
});

describe('settlement-cycle — schema constants', () => {
  it('cycle types are exhaustively locked', () => {
    expect([...CYCLE_TYPES].sort()).toEqual(
      ['END_OF_DAY', 'EXCEPTION', 'INTRADAY_NET', 'RTGS_GROSS'].sort()
    );
  });
});

describe('settlement-cycle — create', () => {
  it('persists a cycle with state pending', async () => {
    const cycle = await settlementCycleService.create({
      cycleType: 'INTRADAY_NET',
      currency: 'GHS',
      operatingDate: '2026-04-27',
      triggeredBy: 'operator:test',
      triggeredReason: 'unit test'
    });
    expect(cycle.state).toBe('pending');
    expect(cycle.cycle_type).toBe('INTRADAY_NET');
  });
});

describe('settlement-cycle — runner', () => {
  it('rejects calls without a confirmation token', async () => {
    const cycle = await settlementCycleService.create({
      cycleType: 'INTRADAY_NET', currency: 'GHS', operatingDate: '2026-04-27', triggeredBy: 'scheduler'
    });
    await expect(runner.runCycle(cycle.id)).rejects.toThrow(/confirmation token/);
    await expect(runner.runCycle(cycle.id, { confirmation: 'xx' })).rejects.toThrow(/confirmation token/);
  });

  it('nets positions across two participants and resets to zero', async () => {
    // Two confirmed transactions push positions to -30000 / +30000.
    await transactionsOrchestrator.process(buildEnv(1));
    await transactionsOrchestrator.process(buildEnv(2));
    const before = await settlementPositionsService.listPositions({ currency: 'GHS' });
    expect(before.find((p) => p.participantCode === ORIG).positionMinor).toBe('-30000');
    expect(before.find((p) => p.participantCode === BENE).positionMinor).toBe('30000');

    const cycle = await settlementCycleService.create({
      cycleType: 'INTRADAY_NET', currency: 'GHS', operatingDate: '2026-04-27', triggeredBy: 'scheduler'
    });
    const result = await runner.runCycle(cycle.id, { confirmation: 'phase-5-cycle-test' });
    expect(result.cycle.state).toBe('completed');
    expect(result.movements.length).toBe(2);
    const after = await settlementPositionsService.listPositions({ currency: 'GHS' });
    expect(after.find((p) => p.participantCode === ORIG).positionMinor).toBe('0');
    expect(after.find((p) => p.participantCode === BENE).positionMinor).toBe('0');
  });

  it('writes an RTGS CSV file with expected schema', async () => {
    await transactionsOrchestrator.process(buildEnv(10));
    const cycle = await settlementCycleService.create({
      cycleType: 'INTRADAY_NET', currency: 'GHS', operatingDate: '2026-04-27', triggeredBy: 'scheduler'
    });
    const result = await runner.runCycle(cycle.id, { confirmation: 'phase-5-rtgs-test' });
    expect(existsSync(result.rtgsPath)).toBe(true);
    const content = readFileSync(result.rtgsPath, 'utf8');
    expect(content.split('\n')[0]).toBe(
      'cycle_id,operating_date,currency,participant_code,direction,amount_minor'
    );
    expect(content).toMatch(/PARTICIPANT_PAYS_RAIL|RAIL_PAYS_PARTICIPANT/);
  });

  it('posts a balanced ledger journal per movement', async () => {
    await transactionsOrchestrator.process(buildEnv(20));
    const cycle = await settlementCycleService.create({
      cycleType: 'INTRADAY_NET', currency: 'GHS', operatingDate: '2026-04-27', triggeredBy: 'scheduler'
    });
    const result = await runner.runCycle(cycle.id, { confirmation: 'phase-5-balance-test' });
    for (const m of result.movements) {
      const journal = await ledgerService.journalById(m.posted_journal_id);
      expect(journal.postings.length).toBe(2);
      const dr = BigInt(journal.postings.find((p) => p.side === 'DR').amount_value);
      const cr = BigInt(journal.postings.find((p) => p.side === 'CR').amount_value);
      expect(dr).toBe(cr);
    }
  });

  it('re-running a completed cycle is a no-op (idempotent)', async () => {
    await transactionsOrchestrator.process(buildEnv(30));
    const cycle = await settlementCycleService.create({
      cycleType: 'INTRADAY_NET', currency: 'GHS', operatingDate: '2026-04-27', triggeredBy: 'scheduler'
    });
    await runner.runCycle(cycle.id, { confirmation: 'phase-5-idem-1' });
    const re = await runner.runCycle(cycle.id, { confirmation: 'phase-5-idem-2' });
    expect(re.idempotent).toBe(true);
  });

  it('rejects running a cycle in an unexpected state', async () => {
    const cycle = await settlementCycleService.create({
      cycleType: 'INTRADAY_NET', currency: 'GHS', operatingDate: '2026-04-27', triggeredBy: 'scheduler'
    });
    await runner.closeCycle(cycle.id, 'operator-killed');
    await expect(runner.runCycle(cycle.id, { confirmation: 'phase-5-bad-state' })).rejects.toThrow(
      /cannot run from state/
    );
  });
});

describe('settlement-cycle — rtgs-output', () => {
  it('formats CSV with PARTICIPANT_PAYS_RAIL / RAIL_PAYS_PARTICIPANT direction', () => {
    const csv = buildRtgsCsv({
      cycleId: 'cycle-1',
      operatingDate: '2026-04-27',
      currency: 'GHS',
      movements: [
        { participantCode: 'A', movementMinor: '500' },
        { participantCode: 'B', movementMinor: '-500' }
      ]
    });
    expect(csv).toMatch(/PARTICIPANT_PAYS_RAIL/);
    expect(csv).toMatch(/RAIL_PAYS_PARTICIPANT/);
    expect(csv).toMatch(/A,PARTICIPANT_PAYS_RAIL,500/);
    expect(csv).toMatch(/B,RAIL_PAYS_PARTICIPANT,500/);
  });
});
