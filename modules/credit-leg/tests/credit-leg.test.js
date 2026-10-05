import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { errorHandler } from '../../../core/http.js';
import { attachContext } from '../../../core/context.js';
import { createEnvelope, envelopeService } from '../../envelope/index.js';
import { participantsService } from '../../participants/index.js';
import { participantOnboardingService } from '../../participant-onboarding/index.js';
import { participantSimulatorRoutes } from '../../participant-simulator/index.js';
import { cryptoKeysService } from '../../crypto-keys/index.js';
import { transactionsService } from '../../transactions/index.js';
import { creditLegService, withTimeout } from '../index.js';

const ORIG = 'CL_BANK_O';
const BENE = 'CL_BANK_B';
let simulatorBaseUrl;
let simulatorServer;

const cleanup = async () => {
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'cl-%'`);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM signing_keys WHERE owner_type IN ('participant') AND owner_id IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participants WHERE code IN ($1,$2)`, [ORIG, BENE]);
};

const onboardActive = async (code) => {
  await participantsService.create({
    code,
    name: code,
    legalName: `${code} PLC`,
    type: 'BANK',
    countryCode: 'GH'
  });
  for (const docType of ['INCORPORATION', 'BOG_LICENSE', 'TAX_CERT', 'BENEFICIAL_OWNERS', 'AML_POLICY']) {
    await participantOnboardingService.uploadKyb({
      code,
      docType,
      fileName: `${docType}.pdf`,
      fileBuffer: Buffer.from('x'),
      uploadedBy: null
    });
    await participantOnboardingService.reviewKyb({ code, docType, status: 'approved', reviewedBy: null });
  }
  await participantOnboardingService.transition({ code, to: 'certifying', actorId: null });
  for (const suite of ['ENVELOPE_ROUNDTRIP', 'CREDIT_LEG', 'IDEMPOTENCY', 'NAME_ENQUIRY']) {
    await participantOnboardingService.runCertSuite({ code, suite });
  }
  await participantOnboardingService.transition({ code, to: 'active', actorId: null });
};

const setBeneficiaryEndpoint = async (code, baseUrl) => {
  await query(
    `UPDATE participants SET endpoints = $2::jsonb, updated_at = now() WHERE code = $1`,
    [
      code,
      JSON.stringify({
        credit_leg: `${baseUrl}/simulator/${code}/credit-leg`,
        status_check: `${baseUrl}/simulator/${code}/status-check`,
        reversal: `${baseUrl}/simulator/${code}/reversal`
      })
    ]
  );
};

const buildEnvelopeFor = (beneAccount, idx = 0) =>
  createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'REST',
    sourceMessageId: `cl-${Date.now()}-${idx}`,
    endToEndId: `cl-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `cl-idem-${Date.now()}-${idx}`,
    originator: {
      participantCode: ORIG,
      accountId: '0001',
      accountType: 'BANK_ACCOUNT',
      name: 'Originator'
    },
    beneficiary: {
      participantCode: BENE,
      accountId: beneAccount,
      accountType: 'BANK_ACCOUNT',
      name: 'Beneficiary'
    },
    amount: { value: '15000', currency: 'GHS' }
  });

const provision = async (beneAccount, idx) => {
  const env = buildEnvelopeFor(beneAccount, idx);
  await envelopeService.ingest(env);
  const tx = await transactionsService.ingestFromEnvelope(env);
  return { env, tx };
};

beforeAll(async () => {
  await cleanup();
  await onboardActive(ORIG);
  await onboardActive(BENE);
  await cryptoKeysService.ensureRailKey();
  // Boot the simulator on an ephemeral port so this test owns its lifecycle.
  const app = express();
  app.use(express.json());
  app.use(attachContext);
  app.use('/simulator', participantSimulatorRoutes);
  app.use(errorHandler);
  await new Promise((resolve) => {
    simulatorServer = app.listen(0, () => resolve());
  });
  const port = simulatorServer.address().port;
  simulatorBaseUrl = `http://127.0.0.1:${port}`;
  await setBeneficiaryEndpoint(BENE, simulatorBaseUrl);
});

afterAll(async () => {
  await new Promise((resolve) => simulatorServer?.close(resolve));
  await cleanup();
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'cl-%'`);
});

describe('credit-leg — withTimeout helper', () => {
  it('races a slow promise against a deadline', async () => {
    const slow = new Promise((r) => setTimeout(() => r('done'), 200));
    await expect(withTimeout(slow, 50, () => new Error('to'))).rejects.toThrow('to');
  });

  it('returns the resolved value when fast', async () => {
    const fast = Promise.resolve('ok');
    expect(await withTimeout(fast, 100, () => new Error('to'))).toBe('ok');
  });
});

describe('credit-leg — categories', () => {
  it('TERMINAL_SUCCESS for any non-force account', async () => {
    const { env, tx } = await provision('1234567890', 1);
    await transactionsService.transition(tx.id, 'AUTHORIZED');
    await transactionsService.transition(tx.id, 'ROUTED');
    await transactionsService.transition(tx.id, 'CREDIT_LEG_PENDING');
    const fresh = await transactionsService.findById(tx.id);
    const r = await creditLegService.run({ transaction: fresh, envelope: env });
    expect(r.category).toBe('TERMINAL_SUCCESS');
    expect(r.reasonCode).toBe('SUCCESS');
  });

  it('TERMINAL_FAIL for AM04 (insufficient funds → 9999000002)', async () => {
    const { env, tx } = await provision('9999000002', 2);
    await transactionsService.transition(tx.id, 'AUTHORIZED');
    await transactionsService.transition(tx.id, 'ROUTED');
    await transactionsService.transition(tx.id, 'CREDIT_LEG_PENDING');
    const r = await creditLegService.run({
      transaction: await transactionsService.findById(tx.id),
      envelope: env
    });
    expect(r.category).toBe('TERMINAL_FAIL');
    expect(r.reasonCode).toBe('INSUFFICIENT_FUNDS');
  });

  it('TERMINAL_FAIL for AC04 (closed account → 9999000003)', async () => {
    const { env, tx } = await provision('9999000003', 3);
    await transactionsService.transition(tx.id, 'AUTHORIZED');
    await transactionsService.transition(tx.id, 'ROUTED');
    await transactionsService.transition(tx.id, 'CREDIT_LEG_PENDING');
    const r = await creditLegService.run({
      transaction: await transactionsService.findById(tx.id),
      envelope: env
    });
    expect(r.category).toBe('TERMINAL_FAIL');
    expect(r.reasonCode).toBe('BENEFICIARY_ACCOUNT_CLOSED');
  });

  it('AMBIGUOUS / TIMEOUT for 9999000007', async () => {
    const { env, tx } = await provision('9999000007', 7);
    await transactionsService.transition(tx.id, 'AUTHORIZED');
    await transactionsService.transition(tx.id, 'ROUTED');
    await transactionsService.transition(tx.id, 'CREDIT_LEG_PENDING');
    const r = await creditLegService.run({
      transaction: await transactionsService.findById(tx.id),
      envelope: env
    });
    expect(r.category).toBe('AMBIGUOUS');
    expect(['TIMEOUT', 'UNREACHABLE']).toContain(r.reasonCode);
  });

  it('SLOW_RESPONSE (9999000008) still returns TERMINAL_SUCCESS in test mode', async () => {
    const { env, tx } = await provision('9999000008', 8);
    await transactionsService.transition(tx.id, 'AUTHORIZED');
    await transactionsService.transition(tx.id, 'ROUTED');
    await transactionsService.transition(tx.id, 'CREDIT_LEG_PENDING');
    const r = await creditLegService.run({
      transaction: await transactionsService.findById(tx.id),
      envelope: env
    });
    expect(r.category).toBe('TERMINAL_SUCCESS');
  });

  it('UNREACHABLE (9999000010) returns AMBIGUOUS / UNREACHABLE', async () => {
    const { env, tx } = await provision('9999000010', 10);
    await transactionsService.transition(tx.id, 'AUTHORIZED');
    await transactionsService.transition(tx.id, 'ROUTED');
    await transactionsService.transition(tx.id, 'CREDIT_LEG_PENDING');
    const r = await creditLegService.run({
      transaction: await transactionsService.findById(tx.id),
      envelope: env
    });
    expect(r.category).toBe('AMBIGUOUS');
    expect(['UNREACHABLE', 'TIMEOUT']).toContain(r.reasonCode);
  });
});

describe('credit-leg — missing endpoint', () => {
  it('AMBIGUOUS / UNREACHABLE when participant has no credit_leg URL', async () => {
    await query(
      `UPDATE participants SET endpoints = '{}'::jsonb WHERE code = $1`,
      [BENE]
    );
    const { env, tx } = await provision('1234500001', 99);
    await transactionsService.transition(tx.id, 'AUTHORIZED');
    await transactionsService.transition(tx.id, 'ROUTED');
    await transactionsService.transition(tx.id, 'CREDIT_LEG_PENDING');
    const r = await creditLegService.run({
      transaction: await transactionsService.findById(tx.id),
      envelope: env
    });
    expect(r.category).toBe('AMBIGUOUS');
    expect(r.reasonCode).toBe('UNREACHABLE');
    // Restore for subsequent tests in this file (none after this one).
    await setBeneficiaryEndpoint(BENE, simulatorBaseUrl);
  });
});
