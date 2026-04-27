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
import { ledgerService, JOURNAL_REASONS, ACCOUNT_TYPES } from '../../ledger/index.js';
import { settlementPositionsService } from '../index.js';

const ORIG = 'P_BANK_O';
const BENE = 'P_BANK_B';
let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions`);
  await query(`DELETE FROM ledger_accounts WHERE owner_id IN ($1,$2) OR account_code = 'OPERATOR_RTGS_NOSTRO:GHS'`, [ORIG, BENE]);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'pos-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'ledger.%'`);
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
    sourceMessageId: `pos-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `pos-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `pos-idem-${Date.now()}-${idx}-${Math.random()}`,
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
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'pos-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'ledger.%'`);
});

describe('settlement positions — applied via the ledger hook', () => {
  it('a single confirmed transaction moves both originator and beneficiary positions', async () => {
    const env = buildEnv(1);
    const r = await transactionsOrchestrator.process(env);
    expect(r.transaction.state).toBe('CONFIRMED');

    const orig = await settlementPositionsService.positionFor(ORIG, 'GHS');
    const bene = await settlementPositionsService.positionFor(BENE, 'GHS');
    expect(orig.positionMinor).toBe('-15000');
    expect(bene.positionMinor).toBe('15000');
  });

  it('multiple confirmed transactions accumulate', async () => {
    for (let i = 0; i < 3; i += 1) {
      await transactionsOrchestrator.process(buildEnv(10 + i));
    }
    const orig = await settlementPositionsService.positionFor(ORIG, 'GHS');
    const bene = await settlementPositionsService.positionFor(BENE, 'GHS');
    expect(orig.positionMinor).toBe('-45000');
    expect(bene.positionMinor).toBe('45000');
  });

  it('positions are isolated per currency', async () => {
    // Manually post a USD journal — no orchestrator path supports cross-
    // currency yet, but the position view must keep them separate.
    await ledgerService.ensureAccount({ accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT, ownerId: ORIG, currency: 'USD' });
    await ledgerService.ensureAccount({ accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT, ownerId: BENE, currency: 'USD' });
    await ledgerService.postJournal({
      reason: JOURNAL_REASONS.TRANSACTION_CONFIRMED,
      operatingDate: '2026-04-27',
      entries: [
        { accountCode: `PSET:${ORIG}:USD`, side: 'DR', amount: '500', currency: 'USD' },
        { accountCode: `PSET:${BENE}:USD`, side: 'CR', amount: '500', currency: 'USD' }
      ]
    });
    await transactionsOrchestrator.process(buildEnv(20)); // GHS

    const ghs = await settlementPositionsService.positionFor(ORIG, 'GHS');
    const usd = await settlementPositionsService.positionFor(ORIG, 'USD');
    expect(ghs.positionMinor).toBe('-15000');
    expect(usd.positionMinor).toBe('-500');
  });

  it('listForParticipant returns one row per currency', async () => {
    await transactionsOrchestrator.process(buildEnv(30));
    const list = await settlementPositionsService.listForParticipant(ORIG);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.every((p) => p.participantCode === ORIG)).toBe(true);
  });
});

describe('settlement positions — recompute', () => {
  it('recompute from journal produces identical balances', async () => {
    for (let i = 0; i < 4; i += 1) {
      await transactionsOrchestrator.process(buildEnv(40 + i));
    }
    const before = await settlementPositionsService.positionFor(ORIG, 'GHS');
    // Wipe positions table; recompute from journal alone should restore.
    await query(`DELETE FROM settlement_positions`);
    await settlementPositionsService.recomputeAll({ currency: 'GHS' });
    const after = await settlementPositionsService.positionFor(ORIG, 'GHS');
    expect(after.positionMinor).toBe(before.positionMinor);
  });
});

describe('settlement positions — read APIs', () => {
  it('positionFor returns zero-shaped row when none exists', async () => {
    const r = await settlementPositionsService.positionFor('UNREGISTRD', 'GHS');
    expect(r.positionMinor).toBe('0');
    expect(r.lastJournalId).toBeNull();
  });

  it('listPositions filters by currency', async () => {
    await transactionsOrchestrator.process(buildEnv(50));
    const ghs = await settlementPositionsService.listPositions({ currency: 'GHS' });
    expect(ghs.every((p) => p.currency === 'GHS')).toBe(true);
    expect(ghs.length).toBeGreaterThanOrEqual(2);
  });
});
