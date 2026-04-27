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
import {
  fraudRulesService,
  fraudRuleContextBuilder,
  RULE_CODES,
  PACK_CODES
} from '../index.js';
import { RAIL_CODES, REASON_TO_ISO_REASON, REASON_TO_CATEGORY } from '../../../core/codes.js';

const ORIG = 'F1_BANK_O';
const BENE = 'F1_BANK_B';
let baseUrl;
let server;
let proposerId;
let approverId;

const cleanup = async () => {
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM fraud_participant_rule_packs WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM fraud_rules`);
  await query(`DELETE FROM fraud_rule_packs`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM ledger_accounts`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'f1-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'fraud.%'`);
  await query(`DELETE FROM users WHERE email IN ('f1-proposer@sika.local','f1-approver@sika.local')`);
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

const buildEnv = (idx) =>
  createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'REST',
    sourceMessageId: `f1-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `f1-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `f1-idem-${Date.now()}-${idx}-${Math.random()}`,
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
  // Two distinct user IDs for maker-checker tests.
  const a = await query(`INSERT INTO users (id, email, name, password_hash) VALUES (gen_random_uuid(), 'f1-proposer@sika.local', 'Proposer', 'x') RETURNING id`);
  const b = await query(`INSERT INTO users (id, email, name, password_hash) VALUES (gen_random_uuid(), 'f1-approver@sika.local', 'Approver', 'x') RETURNING id`);
  proposerId = a.rows[0].id;
  approverId = b.rows[0].id;
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await cleanup();
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM fraud_participant_rule_packs WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM fraud_rules`);
  await query(`DELETE FROM fraud_rule_packs`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM fee_schedules`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'f1-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'fraud.%' OR event_type LIKE 'transaction.%'`);
});

describe('fraud foundation — RAIL_CODES extension', () => {
  it('FRAUD_BLOCK and SANCTIONS_HIT are present in RAIL_CODES', () => {
    expect(RAIL_CODES.FRAUD_BLOCK).toBe('FRAUD_BLOCK');
    expect(RAIL_CODES.SANCTIONS_HIT).toBe('SANCTIONS_HIT');
  });

  it('both reasons map to ISO XT99 (proprietary)', () => {
    expect(REASON_TO_ISO_REASON.FRAUD_BLOCK).toBe('XT99');
    expect(REASON_TO_ISO_REASON.SANCTIONS_HIT).toBe('XT99');
  });

  it('both reasons categorize as TERMINAL_FAIL', () => {
    expect(REASON_TO_CATEGORY.FRAUD_BLOCK).toBe('TERMINAL_FAIL');
    expect(REASON_TO_CATEGORY.SANCTIONS_HIT).toBe('TERMINAL_FAIL');
  });
});

describe('fraud foundation — pack seeding', () => {
  it('seedDefaultPacks installs both packs with all rules', async () => {
    const { packs, rules } = await fraudRulesService.seedDefaultPacks();
    expect(packs.length).toBe(2);
    expect(rules.length).toBe(15);
    const universal = await fraudRulesService.findPackByCode(PACK_CODES.UNIVERSAL_BASELINE_V1);
    expect(universal.rules.length).toBeGreaterThanOrEqual(12);
    const ghana = await fraudRulesService.findPackByCode(PACK_CODES.GHANA_TYPOLOGIES_V1);
    expect(ghana.rules.length).toBe(3);
  });

  it('seedDefaultPacks is idempotent', async () => {
    const a = await fraudRulesService.seedDefaultPacks();
    const b = await fraudRulesService.seedDefaultPacks();
    // The second run inserts no new packs/rules (all conflicts).
    expect(b.packs.length).toBe(2);
    expect(b.rules.length).toBe(0);
    void a;
  });
});

describe('fraud foundation — maker-checker on rule changes', () => {
  it('proposeChange + approveChange (different users) applies the change', async () => {
    await fraudRulesService.seedDefaultPacks();
    const universal = await fraudRulesService.findPackByCode(PACK_CODES.UNIVERSAL_BASELINE_V1);
    const target = universal.rules.find((r) => r.rule_code === RULE_CODES.R001_HIGH_VELOCITY_1H);
    const originalWeight = target.weight;

    const proposed = await fraudRulesService.proposeChange({
      ruleId: target.id,
      pendingChange: { weight: 25 },
      proposedBy: proposerId
    });
    expect(proposed.pending_change).toEqual({ weight: 25 });
    expect(Number(proposed.weight)).toBe(originalWeight); // not yet applied

    const approved = await fraudRulesService.approveChange({
      ruleId: target.id,
      approvedBy: approverId
    });
    expect(approved.pending_change).toBeNull();
    expect(approved.weight).toBe(25);
  });

  it('rejects same-user-proposes-and-approves', async () => {
    await fraudRulesService.seedDefaultPacks();
    const universal = await fraudRulesService.findPackByCode(PACK_CODES.UNIVERSAL_BASELINE_V1);
    const target = universal.rules.find((r) => r.rule_code === RULE_CODES.R002_HIGH_VALUE_VS_BASELINE);
    await fraudRulesService.proposeChange({
      ruleId: target.id,
      pendingChange: { active: false },
      proposedBy: proposerId
    });
    await expect(
      fraudRulesService.approveChange({ ruleId: target.id, approvedBy: proposerId })
    ).rejects.toThrow(/maker-checker/);
  });

  it('approveChange with no pending change is a conflict', async () => {
    await fraudRulesService.seedDefaultPacks();
    const universal = await fraudRulesService.findPackByCode(PACK_CODES.UNIVERSAL_BASELINE_V1);
    const target = universal.rules[0];
    await expect(
      fraudRulesService.approveChange({ ruleId: target.id, approvedBy: approverId })
    ).rejects.toThrow(/no pending change/);
  });
});

describe('fraud foundation — rule context builder', () => {
  it('builds velocity windows and isFirstTime for a fresh transaction', async () => {
    const env = buildEnv(1);
    const r = await transactionsOrchestrator.process(env);
    expect(r.transaction.state).toBe('CONFIRMED');

    const ctx = await fraudRuleContextBuilder.buildContext({
      transaction: r.transaction,
      envelope: env
    });
    expect(ctx.velocity.last1h.count).toBeGreaterThanOrEqual(1);
    expect(ctx.velocity.last24h.count).toBeGreaterThanOrEqual(1);
    // The query excludes the txn under inspection (id <> $5). With no prior
    // tx between this originator/beneficiary pair, isFirstTime is true.
    expect(ctx.beneficiary.isFirstTime).toBe(true);
    expect(ctx.beneficiary.daysSinceFirstSeen).toBe(0);
    expect(ctx.signals.sanctionsHit).toBe(false);
    expect(ctx.signals.networkGraphFlag).toBe(false);
  });

  it('marks isFirstTime=false after a prior confirmed tx between same parties', async () => {
    await transactionsOrchestrator.process(buildEnv(10));
    const env = buildEnv(11);
    const r = await transactionsOrchestrator.process(env);
    const ctx = await fraudRuleContextBuilder.buildContext({
      transaction: r.transaction,
      envelope: env
    });
    expect(ctx.beneficiary.isFirstTime).toBe(false);
  });
});

describe('fraud foundation — participant pack enablement', () => {
  it('enablePackForParticipant scopes which rules are returned to the engine', async () => {
    await fraudRulesService.seedDefaultPacks();
    await fraudRulesService.enablePackForParticipant({
      participantCode: ORIG,
      packCode: PACK_CODES.UNIVERSAL_BASELINE_V1
    });
    const rules = await fraudRulesService.listActiveRulesForParticipant(ORIG);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((r) => r.pack_code === PACK_CODES.UNIVERSAL_BASELINE_V1)).toBe(true);
  });
});

describe('fraud foundation — velocity index exists', () => {
  it('index transactions_originator_time_idx is in pg_indexes', async () => {
    const r = await query(
      `SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'transactions_originator_time_idx'`
    );
    expect(r.rows[0].n).toBe(1);
  });
});
