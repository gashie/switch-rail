import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query, withTransaction } from '../../../core/db.js';
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
  ledgerService,
  ACCOUNT_TYPES,
  JOURNAL_REASONS,
  accountCodeFor
} from '../index.js';

const ORIG = 'L_BANK_O';
const BENE = 'L_BANK_B';
let baseUrl;
let server;

const cleanup = async () => {
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM ledger_accounts WHERE account_code LIKE 'PSET:L_%' OR account_code LIKE '%:L_%'`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'lg-%'`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, BENE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ORIG, BENE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'ledger.%'`);
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

const setBeneEndpoints = async (code, base) => {
  await query(
    `UPDATE participants SET endpoints = $2::jsonb, updated_at = now() WHERE code = $1`,
    [
      code,
      JSON.stringify({
        credit_leg: `${base}/simulator/${code}/credit-leg`,
        status_check: `${base}/simulator/${code}/status-check`,
        reversal: `${base}/simulator/${code}/reversal`
      })
    ]
  );
};

const buildEnv = (beneAccount, idx) =>
  createEnvelope({
    msgType: 'CRDT_TRF',
    sourceFormat: 'REST',
    sourceMessageId: `lg-${Date.now()}-${idx}-${Math.random()}`,
    endToEndId: `lg-e2e-${Date.now()}-${idx}`,
    idempotencyKey: `lg-idem-${Date.now()}-${idx}-${Math.random()}`,
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
  await query(`DELETE FROM fee_schedules`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'lg-%'`);
  await query(`DELETE FROM accounts WHERE participant_code = $1 AND account_number LIKE '02%'`, [BENE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'ledger.%'`);
});

describe('ledger — postJournal validations', () => {
  it('rejects single-sided posts (entries.length < 2)', async () => {
    await ledgerService.ensureAccount({
      accountType: ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT,
      ownerId: ORIG,
      currency: 'GHS'
    });
    await expect(
      ledgerService.postJournal({
        reason: JOURNAL_REASONS.TRANSACTION_CONFIRMED,
        operatingDate: '2026-04-27',
        entries: [{ accountCode: accountCodeFor({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: ORIG, currency: 'GHS' }), side: 'DR', amount: '100', currency: 'GHS' }]
      })
    ).rejects.toThrow(/double-entry/i);
  });

  it('rejects unbalanced journals (DR != CR)', async () => {
    await ledgerService.ensureAccount({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: ORIG, currency: 'GHS' });
    await ledgerService.ensureAccount({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: BENE, currency: 'GHS' });
    await expect(
      ledgerService.postJournal({
        reason: JOURNAL_REASONS.TRANSACTION_CONFIRMED,
        operatingDate: '2026-04-27',
        entries: [
          { accountCode: accountCodeFor({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: ORIG, currency: 'GHS' }), side: 'DR', amount: '500', currency: 'GHS' },
          { accountCode: accountCodeFor({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: BENE, currency: 'GHS' }), side: 'CR', amount: '300', currency: 'GHS' }
        ]
      })
    ).rejects.toThrow(/does not balance/i);
  });

  it('rejects mixed currencies that do not balance per-currency', async () => {
    await ledgerService.ensureAccount({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: ORIG, currency: 'GHS' });
    await ledgerService.ensureAccount({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: BENE, currency: 'GHS' });
    await ledgerService.ensureAccount({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: ORIG, currency: 'USD' });
    await expect(
      ledgerService.postJournal({
        reason: JOURNAL_REASONS.TRANSACTION_CONFIRMED,
        operatingDate: '2026-04-27',
        entries: [
          { accountCode: accountCodeFor({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: ORIG, currency: 'GHS' }), side: 'DR', amount: '500', currency: 'GHS' },
          { accountCode: accountCodeFor({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: BENE, currency: 'GHS' }), side: 'CR', amount: '500', currency: 'GHS' },
          { accountCode: accountCodeFor({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: ORIG, currency: 'USD' }), side: 'DR', amount: '100', currency: 'USD' }
        ]
      })
    ).rejects.toThrow(/does not balance for USD/);
  });

  it('rejects posting to a missing account', async () => {
    await ledgerService.ensureAccount({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: ORIG, currency: 'GHS' });
    await expect(
      ledgerService.postJournal({
        reason: JOURNAL_REASONS.TRANSACTION_CONFIRMED,
        operatingDate: '2026-04-27',
        entries: [
          { accountCode: accountCodeFor({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: ORIG, currency: 'GHS' }), side: 'DR', amount: '500', currency: 'GHS' },
          { accountCode: 'PSET:DOES_NOT_EXIST:GHS', side: 'CR', amount: '500', currency: 'GHS' }
        ]
      })
    ).rejects.toThrow(/does not exist/);
  });

  it('rejects negative or zero amounts', async () => {
    await ledgerService.ensureAccount({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: ORIG, currency: 'GHS' });
    await ledgerService.ensureAccount({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: BENE, currency: 'GHS' });
    await expect(
      ledgerService.postJournal({
        reason: JOURNAL_REASONS.TRANSACTION_CONFIRMED,
        operatingDate: '2026-04-27',
        entries: [
          { accountCode: accountCodeFor({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: ORIG, currency: 'GHS' }), side: 'DR', amount: '0', currency: 'GHS' },
          { accountCode: accountCodeFor({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: BENE, currency: 'GHS' }), side: 'CR', amount: '0', currency: 'GHS' }
        ]
      })
    ).rejects.toThrow(/amount must be positive/);
  });
});

describe('ledger — happy path posting', () => {
  it('posts a balanced 2-leg journal and updates balances correctly', async () => {
    await ledgerService.ensureAccount({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: ORIG, currency: 'GHS' });
    await ledgerService.ensureAccount({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: BENE, currency: 'GHS' });

    const result = await ledgerService.postJournal({
      reason: JOURNAL_REASONS.TRANSACTION_CONFIRMED,
      referenceType: 'transaction',
      referenceId: 'demo-tx-1',
      operatingDate: '2026-04-27',
      entries: [
        { accountCode: 'PSET:L_BANK_O:GHS', side: 'DR', amount: '15000', currency: 'GHS' },
        { accountCode: 'PSET:L_BANK_B:GHS', side: 'CR', amount: '15000', currency: 'GHS' }
      ]
    });
    expect(result.journalId).toBeTruthy();
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);

    const origBal = await ledgerService.balanceFor('PSET:L_BANK_O:GHS');
    const beneBal = await ledgerService.balanceFor('PSET:L_BANK_B:GHS');
    expect(origBal).toBe(-15000n);
    expect(beneBal).toBe(15000n);
  });
});

describe('ledger — hash chain', () => {
  it('chains prev_hash across multiple journals on the same operating_date', async () => {
    await ledgerService.ensureAccount({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: ORIG, currency: 'GHS' });
    await ledgerService.ensureAccount({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: BENE, currency: 'GHS' });
    for (let i = 0; i < 3; i += 1) {
      await ledgerService.postJournal({
        reason: JOURNAL_REASONS.TRANSACTION_CONFIRMED,
        referenceType: 'transaction',
        referenceId: `tx-${i}`,
        operatingDate: '2026-04-28',
        entries: [
          { accountCode: 'PSET:L_BANK_O:GHS', side: 'DR', amount: '1000', currency: 'GHS' },
          { accountCode: 'PSET:L_BANK_B:GHS', side: 'CR', amount: '1000', currency: 'GHS' }
        ]
      });
    }
    const verify = await ledgerService.verifyDayChain('2026-04-28');
    expect(verify.ok).toBe(true);
    expect(verify.count).toBe(3);
  });

  it('detects tampering — overwriting hash breaks the chain', async () => {
    await ledgerService.ensureAccount({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: ORIG, currency: 'GHS' });
    await ledgerService.ensureAccount({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: BENE, currency: 'GHS' });
    const a = await ledgerService.postJournal({
      reason: JOURNAL_REASONS.TRANSACTION_CONFIRMED,
      operatingDate: '2026-04-29',
      entries: [
        { accountCode: 'PSET:L_BANK_O:GHS', side: 'DR', amount: '1000', currency: 'GHS' },
        { accountCode: 'PSET:L_BANK_B:GHS', side: 'CR', amount: '1000', currency: 'GHS' }
      ]
    });
    await ledgerService.postJournal({
      reason: JOURNAL_REASONS.TRANSACTION_CONFIRMED,
      operatingDate: '2026-04-29',
      entries: [
        { accountCode: 'PSET:L_BANK_O:GHS', side: 'DR', amount: '500', currency: 'GHS' },
        { accountCode: 'PSET:L_BANK_B:GHS', side: 'CR', amount: '500', currency: 'GHS' }
      ]
    });
    // Tamper: rewrite the first journal's hash.
    await query(`UPDATE ledger_journal SET hash = 'tampered' WHERE id = $1`, [a.journalId]);
    const verify = await ledgerService.verifyDayChain('2026-04-29');
    expect(verify.ok).toBe(false);
  });
});

describe('ledger — Phase 4 retroactive integration', () => {
  it('a confirmed payment via the orchestrator produces a balanced journal', async () => {
    await ensureBeneAccount('0234000001');
    const env = buildEnv('0234000001', 1);
    const r = await transactionsOrchestrator.process(env);
    expect(r.transaction.state).toBe('CONFIRMED');
    expect(r.ledger?.journalId).toBeTruthy();

    const journals = await ledgerService.journalsByReference('transaction', r.transaction.id);
    expect(journals.length).toBe(1);
    const detail = await ledgerService.journalById(journals[0].id);
    expect(detail.postings.length).toBe(2);
    const dr = detail.postings.find((p) => p.side === 'DR');
    const cr = detail.postings.find((p) => p.side === 'CR');
    expect(dr.account_code).toBe(`PSET:${ORIG}:GHS`);
    expect(cr.account_code).toBe(`PSET:${BENE}:GHS`);
    expect(String(dr.amount_value)).toBe('15000');
    expect(String(cr.amount_value)).toBe('15000');
  });

  it('a forced ledger failure rolls back the CONFIRMED state transition', async () => {
    await ensureBeneAccount('0234000002');
    const env = buildEnv('0234000002', 2);
    // Drop the beneficiary account in the ledger by closing it just in
    // time — the service must reject CONFIRMED postings to a non-active
    // account, and the orchestrator's transaction must roll back.
    await ledgerService.ensureAccount({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: BENE, currency: 'GHS' });
    await query(`UPDATE ledger_accounts SET status = 'closed' WHERE account_code = $1`, [`PSET:${BENE}:GHS`]);
    let caught = null;
    try {
      await transactionsOrchestrator.process(env);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    // Re-open so subsequent tests work; assert no transaction lingered.
    await query(`UPDATE ledger_accounts SET status = 'active' WHERE account_code = $1`, [`PSET:${BENE}:GHS`]);
    const txCount = await query(`SELECT count(*)::int AS n FROM transactions WHERE envelope_id = $1`, [env.envelopeId]);
    expect(txCount.rows[0].n).toBe(0);
  });
});

describe('ledger — accounts and lookup', () => {
  it('ensureAccount is idempotent', async () => {
    const a = await ledgerService.ensureAccount({ accountType: 'RAIL_FEE_REVENUE', currency: 'GHS' });
    const b = await ledgerService.ensureAccount({ accountType: 'RAIL_FEE_REVENUE', currency: 'GHS' });
    expect(a.account_code).toBe(b.account_code);
  });

  it('listAccounts filters by ownerType and currency', async () => {
    await ledgerService.ensureAccount({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: ORIG, currency: 'GHS' });
    await ledgerService.ensureAccount({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: BENE, currency: 'GHS' });
    await ledgerService.ensureAccount({ accountType: 'RAIL_FEE_REVENUE', currency: 'GHS' });
    const partList = await ledgerService.listAccounts({ ownerType: 'PARTICIPANT', currency: 'GHS' });
    expect(partList.every((a) => a.owner_type === 'PARTICIPANT')).toBe(true);
    expect(partList.length).toBeGreaterThanOrEqual(2);
  });
});

describe('ledger — atomicity inside withTransaction', () => {
  it('postJournal participates in the caller transaction (rollback wipes journal)', async () => {
    await ledgerService.ensureAccount({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: ORIG, currency: 'GHS' });
    await ledgerService.ensureAccount({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: BENE, currency: 'GHS' });
    let journalId = null;
    try {
      await withTransaction(async (client) => {
        const r = await ledgerService.postJournal(client, {
          reason: JOURNAL_REASONS.TRANSACTION_CONFIRMED,
          operatingDate: '2026-04-30',
          entries: [
            { accountCode: 'PSET:L_BANK_O:GHS', side: 'DR', amount: '777', currency: 'GHS' },
            { accountCode: 'PSET:L_BANK_B:GHS', side: 'CR', amount: '777', currency: 'GHS' }
          ]
        });
        journalId = r.journalId;
        throw new Error('rollback please');
      });
    } catch {
      /* intentional */
    }
    const after = await query(`SELECT count(*)::int AS n FROM ledger_journal WHERE id = $1`, [journalId]);
    expect(after.rows[0].n).toBe(0);
  });
});
