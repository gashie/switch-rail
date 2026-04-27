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
import { transactionsOrchestrator, transactionsService } from '../../transactions/index.js';
import { fraudFlagsService } from '../index.js';
import { fraudRuleContextBuilder } from '../../fraud/index.js';

const ORIG = 'FF_BANK_O';
const BENE = 'FF_BANK_B';
let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM fraud_flags`);
  await query(`DELETE FROM graph_alerts`);
  await query(`DELETE FROM graph_edges`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM ledger_accounts`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'ff-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'fraud%'`);
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
    sourceMessageId: `ff-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `ff-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `ff-idem-${Date.now()}-${idx}-${Math.random()}`,
    originator: { participantCode: ORIG, accountId: '0123000001', accountType: 'BANK_ACCOUNT', name: 'O' },
    beneficiary: { participantCode: BENE, accountId: '0234000001', accountType: 'BANK_ACCOUNT', name: 'B' },
    amount: { value: '15000', currency: 'GHS' }
  });

beforeAll(async () => {
  await cleanup();
  await onboardActive(ORIG);
  await onboardActive(BENE);
  await directoryService.register({ participantCode: ORIG, accountType: 'BANK_ACCOUNT', accountNumber: '0123000001', accountName: 'O', currency: 'GHS' });
  await directoryService.register({ participantCode: BENE, accountType: 'BANK_ACCOUNT', accountNumber: '0234000001', accountName: 'B', currency: 'GHS' });
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
  await query(`DELETE FROM fraud_flags`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM fee_schedules`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'ff-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'fraud%'`);
});

describe('fraud-flags — flag and listActive', () => {
  it('a new flag is retrievable as active', async () => {
    const flag = await fraudFlagsService.flag({
      subjectType: 'ACCOUNT',
      subjectKey: `${BENE}:0234000001`,
      flagType: 'CONFIRMED_FRAUD',
      flaggedBy: ORIG,
      severity: 90
    });
    expect(flag.id).toBeTruthy();
    const list = await fraudFlagsService.listActive({});
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(flag.id);
  });

  it('withdraw removes it from active listing', async () => {
    const flag = await fraudFlagsService.flag({
      subjectType: 'ACCOUNT',
      subjectKey: `${BENE}:0234000001`,
      flagType: 'SUSPICIOUS',
      flaggedBy: ORIG
    });
    await fraudFlagsService.withdraw({ id: flag.id, withdrawnBy: ORIG });
    const list = await fraudFlagsService.listActive({});
    expect(list.length).toBe(0);
  });

  it('expired flags drop out of active listing', async () => {
    const flag = await fraudFlagsService.flag({
      subjectType: 'ACCOUNT',
      subjectKey: `${BENE}:0234000001`,
      flagType: 'SUSPICIOUS',
      flaggedBy: ORIG,
      expiresInDays: 90
    });
    // Backdate expiry to the past via direct query.
    await query(`UPDATE fraud_flags SET expires_at = now() - interval '1 day' WHERE id = $1`, [flag.id]);
    const list = await fraudFlagsService.listActive({});
    expect(list.find((f) => f.id === flag.id)).toBeUndefined();
  });
});

describe('fraud-flags — severity composition', () => {
  it('multiple flags compound into max severity', async () => {
    await fraudFlagsService.flag({
      subjectType: 'ACCOUNT',
      subjectKey: `${BENE}:0234000001`,
      flagType: 'SUSPICIOUS',
      flaggedBy: ORIG,
      severity: 30
    });
    await fraudFlagsService.flag({
      subjectType: 'ACCOUNT',
      subjectKey: `${BENE}:0234000001`,
      flagType: 'CONFIRMED_FRAUD',
      flaggedBy: 'OTHER_BNK',
      severity: 90
    });
    const out = await fraudFlagsService.lookupPeerFlagSeverity({
      subjectType: 'ACCOUNT',
      subjectKey: `${BENE}:0234000001`
    });
    expect(out.maxSeverity).toBe(90);
    expect(out.count).toBe(2);
  });
});

describe('fraud-flags — engine integration (R011)', () => {
  it('an active flag on the beneficiary surfaces as signals.prevFlaggedByPeer', async () => {
    await fraudFlagsService.flag({
      subjectType: 'ACCOUNT',
      subjectKey: `${BENE}:0234000001`,
      flagType: 'CONFIRMED_FRAUD',
      flaggedBy: 'OTHER_BNK',
      severity: 95
    });
    // Insert a synthetic transaction (don't run orchestrator — that would
    // BLOCK on R011 because of severity 95).
    const env = buildEnv(1);
    const r = await transactionsOrchestrator.process(env);
    void r;
    // Re-fetch a transaction to feed into the context builder. If the
    // orchestrator blocked, fetch by envelope.
    const tx = (await query(`SELECT * FROM transactions WHERE envelope_id = $1`, [env.envelopeId])).rows[0];
    const ctx = await fraudRuleContextBuilder.buildContext({ transaction: tx });
    expect(ctx.signals.prevFlaggedByPeer).toBe(true);
    expect(ctx.signals.peerFlagSeverity).toBe(95);
    void transactionsService;
  });
});
