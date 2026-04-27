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
import { reversalsService, REASON_CODES } from '../index.js';

const ORIG = 'REV_BANK_O';
const BENE = 'REV_BANK_B';
let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'rev-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%'`);
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

const setBeneEndpoints = async (code, base, { reversalUrl } = {}) => {
  await query(
    `UPDATE participants SET endpoints = $2::jsonb, updated_at = now() WHERE code = $1`,
    [
      code,
      JSON.stringify({
        credit_leg: `${base}/simulator/${code}/credit-leg`,
        status_check: `${base}/simulator/${code}/status-check`,
        reversal: reversalUrl ?? `${base}/simulator/${code}/reversal`
      })
    ]
  );
};

const buildEnv = (beneAccount, idx) =>
  createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'REST',
    sourceMessageId: `rev-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `rev-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `rev-idem-${Date.now()}-${idx}-${Math.random()}`,
    originator: {
      participantCode: ORIG,
      accountId: '0123000001',
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

const ensureBeneAccount = async (account) => {
  await directoryService.register({
    participantCode: BENE,
    accountType: 'BANK_ACCOUNT',
    accountNumber: account,
    accountName: 'Beneficiary',
    currency: 'GHS'
  });
};

beforeAll(async () => {
  await cleanup();
  await onboardActive(ORIG);
  await onboardActive(BENE);
  await directoryService.register({
    participantCode: ORIG,
    accountType: 'BANK_ACCOUNT',
    accountNumber: '0123000001',
    accountName: 'Originator',
    currency: 'GHS'
  });
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
  await query(`DELETE FROM accounts WHERE participant_code = $1 AND account_number LIKE '02%'`, [BENE]);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'rev-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%'`);
  await setBeneEndpoints(BENE, baseUrl);
});

const confirmTx = async (idx, beneAccount = '0234000001') => {
  await ensureBeneAccount(beneAccount);
  const env = buildEnv(beneAccount, idx);
  const r = await transactionsOrchestrator.process(env);
  if (r.transaction.state !== 'CONFIRMED') {
    throw new Error(`expected CONFIRMED, got ${r.transaction.state}`);
  }
  return r.transaction;
};

describe('reversals — reason codes', () => {
  it('locks the canonical reason code set', () => {
    expect([...REASON_CODES].sort()).toEqual(
      ['CUST', 'DUPL', 'FRAD', 'RECON_FAILED', 'RGLT', 'TECH'].sort()
    );
  });
});

describe('reversals — initiate happy path', () => {
  it('reverses a CONFIRMED transaction and unwinds the original to REVERSED', async () => {
    const original = await confirmTx(1);

    const result = await reversalsService.initiate({
      originalTxId: original.id,
      reasonCode: 'CUST',
      reasonMessage: 'customer-requested test reversal',
      initiatedBy: 'system'
    });

    expect(result.reversal.state).toBe('CONFIRMED');
    expect(result.reversal.original_transaction_id).toBe(original.id);
    expect(result.originalUpdated.state).toBe('REVERSED');
    expect(result.originalUpdated.reversal_transaction_id).toBe(result.reversal.id);
    expect(result.originalUpdated.reason_code).toBe('CUST');

    // The reversal txn has originator/beneficiary swapped vs. the original.
    expect(result.reversal.originator_participant).toBe(original.beneficiary_participant);
    expect(result.reversal.beneficiary_participant).toBe(original.originator_participant);
    expect(result.reversal.originator_account).toBe(original.beneficiary_account);
    expect(result.reversal.beneficiary_account).toBe(original.originator_account);
  });

  it('writes audit events for both initiation and callback', async () => {
    const original = await confirmTx(2);
    const r = await reversalsService.initiate({
      originalTxId: original.id,
      reasonCode: 'DUPL',
      initiatedBy: 'operator:test-user'
    });
    const audit = await query(
      `SELECT event_type FROM audit_events WHERE resource_id = $1 ORDER BY ts ASC`,
      [r.reversal.id]
    );
    const types = audit.rows.map((row) => row.event_type);
    expect(types).toContain('transaction.reversal.initiated');
    expect(types).toContain('transaction.reversal.callback');
  });
});

describe('reversals — initiate validation', () => {
  it('rejects a non-CONFIRMED original (e.g. REJECTED)', async () => {
    await ensureBeneAccount('9999000002'); // AM04 force-rejected
    const env = buildEnv('9999000002', 10);
    const r = await transactionsOrchestrator.process(env);
    expect(r.transaction.state).toBe('REJECTED');

    await expect(
      reversalsService.initiate({
        originalTxId: r.transaction.id,
        reasonCode: 'CUST',
        initiatedBy: 'system'
      })
    ).rejects.toThrow(/cannot reverse a transaction in state REJECTED/);
  });

  it('rejects an unknown reason code', async () => {
    const original = await confirmTx(3);
    await expect(
      reversalsService.initiate({
        originalTxId: original.id,
        reasonCode: 'NOT_A_REAL_CODE',
        initiatedBy: 'system'
      })
    ).rejects.toThrow(/invalid reversal reasonCode/);
  });

  it('rejects double-reversal (the original is already REVERSED)', async () => {
    const original = await confirmTx(4);
    await reversalsService.initiate({
      originalTxId: original.id,
      reasonCode: 'CUST',
      initiatedBy: 'system'
    });
    await expect(
      reversalsService.initiate({
        originalTxId: original.id,
        reasonCode: 'CUST',
        initiatedBy: 'system'
      })
    ).rejects.toThrow(/cannot reverse a transaction in state REVERSED/);
  });

  it('rejects reversal of a missing transaction', async () => {
    await expect(
      reversalsService.initiate({
        originalTxId: '00000000-0000-7000-8000-000000000000',
        reasonCode: 'CUST',
        initiatedBy: 'system'
      })
    ).rejects.toThrow(/not found/);
  });
});

describe('reversals — failure path', () => {
  it('leaves the original CONFIRMED and the reversal REJECTED when the participant call fails', async () => {
    // Point the beneficiary's reversal endpoint to nothing — the call will
    // fail with a network error.
    await setBeneEndpoints(BENE, baseUrl, {
      reversalUrl: 'http://127.0.0.1:1/simulator/REV_BANK_B/reversal'
    });
    const original = await confirmTx(5);

    const r = await reversalsService.initiate({
      originalTxId: original.id,
      reasonCode: 'TECH',
      initiatedBy: 'system'
    });

    expect(r.reversal.state).toBe('REJECTED');
    const stillOriginal = await transactionsService.findById(original.id);
    expect(stillOriginal.state).toBe('CONFIRMED');
    expect(stillOriginal.reversal_transaction_id).toBeNull();
  });
});

describe('reversals — listing', () => {
  it('listForOriginal returns the linked reversal transaction', async () => {
    const original = await confirmTx(6);
    const r = await reversalsService.initiate({
      originalTxId: original.id,
      reasonCode: 'CUST',
      initiatedBy: 'system'
    });
    const list = await reversalsService.listForOriginal(original.id);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(r.reversal.id);
  });

  it('findById returns only reversal-shaped transactions', async () => {
    const original = await confirmTx(7);
    const r = await reversalsService.initiate({
      originalTxId: original.id,
      reasonCode: 'CUST',
      initiatedBy: 'system'
    });
    const fetched = await reversalsService.findById(r.reversal.id);
    expect(fetched?.id).toBe(r.reversal.id);

    // The original (no original_transaction_id) is invisible to reversals.findById.
    const wrong = await reversalsService.findById(original.id);
    expect(wrong).toBeNull();
  });
});
