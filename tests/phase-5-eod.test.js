// Phase 5 in-process exit gate: open a day, run a batch of confirmed
// transactions, verify the ledger balances + positions accumulate, run
// an intraday cycle, run EOD cutover, verify statements + day rollover +
// recon clean. The bash demo (scripts/demo-phase-5.sh) exercises the same
// flow over HTTP; this is the CI counterpart.
import express from 'express';
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
import { transactionsOrchestrator } from '../modules/transactions/index.js';
import { ledgerService } from '../modules/ledger/index.js';
import { settlementPositionsService } from '../modules/settlement/index.js';
import { liquidityService } from '../modules/liquidity/index.js';
import { feesService } from '../modules/fees/index.js';
import {
  settlementCycleService,
  settlementCycleRunner
} from '../modules/settlement-cycle/index.js';
import { eodService } from '../modules/eod/index.js';
import {
  reconciliationService
} from '../modules/reconciliation/index.js';

const A = 'P5EBANK1';
const B = 'P5EBANK2';
let baseUrl;
let server;

const today = () => new Date().toISOString().slice(0, 10);

const cleanup = async () => {
  await query(`DELETE FROM reconciliation_breaks`);
  await query(`DELETE FROM reconciliation_runs`);
  await query(`DELETE FROM settlement_statements`);
  await query(`DELETE FROM operating_days`);
  await query(`DELETE FROM settlement_cycle_movements`);
  await query(`DELETE FROM settlement_cycles`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [A, B]);
  await query(`DELETE FROM ledger_accounts`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM liquidity_topups WHERE participant_code IN ($1,$2)`, [A, B]);
  await query(`DELETE FROM liquidity_limits WHERE participant_code IN ($1,$2)`, [A, B]);
  await query(`DELETE FROM fee_schedules WHERE schedule_code LIKE 'P5E-%'`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'p5e-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [A, B]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [A, B]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [A, B]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [A, B]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'cycle.%' OR event_type LIKE 'eod.%' OR event_type LIKE 'recon.%' OR event_type LIKE 'settlement.%' OR event_type LIKE 'fees.%' OR event_type LIKE 'liquidity.%'`);
  await query(`DELETE FROM participants WHERE code IN ($1,$2)`, [A, B]);
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

const buildEnv = (idx, fromA = true) =>
  createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'REST',
    sourceMessageId: `p5e-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `p5e-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `p5e-idem-${Date.now()}-${idx}-${Math.random()}`,
    originator: {
      participantCode: fromA ? A : B,
      accountId: fromA ? '5100000001' : '5200000001',
      accountType: 'BANK_ACCOUNT',
      name: fromA ? 'Sender' : 'Receiver'
    },
    beneficiary: {
      participantCode: fromA ? B : A,
      accountId: fromA ? '5200000001' : '5100000001',
      accountType: 'BANK_ACCOUNT',
      name: fromA ? 'Receiver' : 'Sender'
    },
    amount: { value: String(15000 + idx * 100), currency: 'GHS' }
  });

beforeAll(async () => {
  await cleanup();
  await onboardActive(A);
  await onboardActive(B);
  await directoryService.register({ participantCode: A, accountType: 'BANK_ACCOUNT', accountNumber: '5100000001', accountName: 'Sender', currency: 'GHS' });
  await directoryService.register({ participantCode: B, accountType: 'BANK_ACCOUNT', accountNumber: '5200000001', accountName: 'Receiver', currency: 'GHS' });
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
  await setBeneEndpoints(A, baseUrl);
  await setBeneEndpoints(B, baseUrl);
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await cleanup();
  await closePool();
});

describe('phase-5 — full operating day simulation', () => {
  it('opens a day, runs txs, runs intraday cycle, EOD cutover, recon clean', async () => {
    // 1. Open today's operating day.
    const day = await eodService.ensureToday();
    expect(day.state).toBe('OPEN');

    // 2. Configure liquidity for both participants.
    for (const code of [A, B]) {
      await liquidityService.configureLimits({
        participantCode: code,
        currency: 'GHS',
        prefundedMinor: '10000000',
        floorMinor: '0',
        ceilingMinor: '5000000',
        throttleThresholdPct: 80
      });
    }

    // 3. Publish a fee schedule.
    await feesService.publishSchedule({
      scheduleCode: 'P5E-GHS-DOMESTIC-INSTANT',
      railClass: 'DOMESTIC_INSTANT',
      currency: 'GHS',
      feeType: 'FLAT',
      flatMinor: '50'
    });

    // 4. Run 10 transactions — alternating direction so positions net out.
    let confirmed = 0;
    for (let i = 1; i <= 10; i += 1) {
      const r = await transactionsOrchestrator.process(buildEnv(i, i % 2 === 1));
      if (r.transaction.state === 'CONFIRMED') confirmed += 1;
    }
    expect(confirmed).toBe(10);

    // 5. Verify ledger chain holds.
    const verify1 = await ledgerService.verifyDayChain(today());
    expect(verify1.ok).toBe(true);

    // 6. Both participants have non-zero positions before the cycle.
    const before = await settlementPositionsService.listPositions({ currency: 'GHS' });
    const aBefore = before.find((p) => p.participantCode === A);
    const bBefore = before.find((p) => p.participantCode === B);
    expect(BigInt(aBefore.positionMinor)).not.toBe(0n);
    expect(BigInt(bBefore.positionMinor)).not.toBe(0n);

    // 7. Run an intraday cycle.
    const cycle = await settlementCycleService.create({
      cycleType: 'INTRADAY_NET',
      currency: 'GHS',
      operatingDate: today(),
      triggeredBy: 'scheduler'
    });
    const ran = await settlementCycleRunner.runCycle(cycle.id, { confirmation: 'p5e-intraday' });
    expect(ran.cycle.state).toBe('completed');

    // 8. Positions reset post-cycle.
    const after = await settlementPositionsService.listPositions({ currency: 'GHS' });
    expect(after.find((p) => p.participantCode === A).positionMinor).toBe('0');
    expect(after.find((p) => p.participantCode === B).positionMinor).toBe('0');

    // 9. Run 5 more transactions, then EOD cutover.
    for (let i = 11; i <= 15; i += 1) {
      await transactionsOrchestrator.process(buildEnv(i, i % 2 === 1));
    }
    const cutover = await eodService.cutover({
      operatingDate: today(),
      confirmation: 'p5e-cutover'
    });
    expect(cutover.day.state).toBe('CLOSED');
    expect(cutover.statements.length).toBeGreaterThanOrEqual(2);
    expect(cutover.nextDay.state).toBe('OPEN');

    // 10. Reconciliation against the identity feed: zero breaks.
    const reconRun = await reconciliationService.runReconciliation({
      participantCode: A,
      currency: 'GHS',
      operatingDate: today(),
      runType: 'EOD'
    });
    expect(reconRun.run.total_breaks).toBe(0);

    // 11. Re-running EOD on the closed day is rejected.
    await expect(
      eodService.cutover({ operatingDate: today(), confirmation: 'p5e-second' })
    ).rejects.toThrow(/already CLOSED/);
  });
});
