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
import { sanctionsService, sanctionsScreener } from '../index.js';

const ORIG = 'SAN_BNK_O';
const BENE = 'SAN_BNK_B';
let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM watchlist_entries`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM account_baselines`);
  await query(`DELETE FROM fraud_participant_rule_packs`);
  await query(`DELETE FROM fraud_rules`);
  await query(`DELETE FROM fraud_rule_packs`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM ledger_accounts`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'san-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'fraud.%'`);
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
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM watchlist_entries`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM fee_schedules`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'san-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'fraud.%'`);
  sanctionsScreener._cache.clear();
});

const buildEnv = (idx, beneName = 'Beneficiary') =>
  createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'REST',
    sourceMessageId: `san-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `san-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `san-idem-${Date.now()}-${idx}-${Math.random()}`,
    originator: { participantCode: ORIG, accountId: '0123000001', accountType: 'BANK_ACCOUNT', name: 'Kofi Mensah' },
    beneficiary: { participantCode: BENE, accountId: '0234000001', accountType: 'BANK_ACCOUNT', name: beneName },
    amount: { value: '15000', currency: 'GHS' }
  });

describe('sanctions — provider seed + listing', () => {
  it('seedFakeProviders inserts entries from all 4 providers', async () => {
    const r = await sanctionsService.seedFakeProviders();
    expect(r.total).toBeGreaterThanOrEqual(8);
    const all = await sanctionsService.listEntries({ limit: 50 });
    expect(all.length).toBeGreaterThanOrEqual(8);
  });

  it('seedFakeProviders is idempotent', async () => {
    const a = await sanctionsService.seedFakeProviders();
    const b = await sanctionsService.seedFakeProviders();
    expect(b.total).toBe(0);
    void a;
  });
});

describe('sanctions — screening', () => {
  beforeEach(async () => {
    await sanctionsService.seedFakeProviders();
  });

  it('strong match on a sanctions name → hit', async () => {
    const r = await sanctionsService.screen({ name: 'OSAMA TEST PERSON' });
    expect(r.hit).toBe(true);
    expect(r.matches.some((m) => m.matchType === 'STRONG_MATCH')).toBe(true);
  });

  it('weak/no match on an ordinary name → no hit', async () => {
    const r = await sanctionsService.screen({ name: 'KOFI MENSAH' });
    expect(r.hit).toBe(false);
  });

  it('PEP match returns watchlistHit but not hit', async () => {
    const r = await sanctionsService.screen({ name: 'POLITICALLY EXPOSED PERSON' });
    expect(r.hit).toBe(false);
    expect(r.watchlistHit).toBe(true);
  });

  it('Ghanacard PIN exact match flags as hit on a blacklist entry', async () => {
    const r = await sanctionsService.screen({ name: 'unrelated', ghanacardPin: 'GHA-FRAUDSTER-001' });
    expect(r.hit).toBe(true);
    expect(r.matches.some((m) => m.matchType === 'GHANACARD_MATCH')).toBe(true);
  });

  it('cache-warm screening is fast', async () => {
    await sanctionsService.screen({ name: 'OSAMA TEST PERSON' });
    const t0 = Date.now();
    const samples = [];
    for (let i = 0; i < 50; i += 1) {
      const start = Date.now();
      await sanctionsService.screen({ name: 'OSAMA TEST PERSON' });
      samples.push(Date.now() - start);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    void t0;
    expect(p95).toBeLessThan(5);
  });
});

describe('sanctions — orchestrator integration', () => {
  it('a transaction whose beneficiary name matches sanctions BLOCKs with SANCTIONS_HIT', async () => {
    await sanctionsService.seedFakeProviders();
    const env = buildEnv(1, 'OSAMA TEST PERSON');
    const r = await transactionsOrchestrator.process(env);
    expect(r.transaction.state).toBe('REJECTED');
    expect(r.transaction.reason_code).toBe('SANCTIONS_HIT');
  });

  it('a clean transaction passes the sanctions check', async () => {
    await sanctionsService.seedFakeProviders();
    const env = buildEnv(2, 'Ama Asante');
    const r = await transactionsOrchestrator.process(env);
    expect(r.transaction.state).toBe('CONFIRMED');
  });
});

describe('sanctions — entry CRUD', () => {
  it('upsertEntry persists and listEntries returns the row', async () => {
    const inserted = await sanctionsService.upsertEntry({
      source: 'INTERNAL',
      listType: 'BLACKLIST',
      sourceRecordId: 'TEST-CRUD-1',
      primaryName: 'CRUD TEST PERSON',
      aliases: ['CRUD T'],
      reason: 'unit test'
    });
    expect(inserted.id).toBeTruthy();
    const list = await sanctionsService.listEntries({ source: 'INTERNAL' });
    expect(list.some((e) => e.id === inserted.id)).toBe(true);
  });

  it('removeEntry soft-deletes — entry no longer in active listing', async () => {
    const inserted = await sanctionsService.upsertEntry({
      source: 'INTERNAL', listType: 'GREYLIST',
      sourceRecordId: 'TEST-CRUD-2',
      primaryName: 'TO BE REMOVED'
    });
    await sanctionsService.removeEntry(inserted.id);
    const list = await sanctionsService.listEntries({ source: 'INTERNAL' });
    expect(list.some((e) => e.id === inserted.id)).toBe(false);
  });
});
