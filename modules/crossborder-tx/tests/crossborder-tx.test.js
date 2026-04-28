import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { createEnvelope } from '../../envelope/index.js';
import { participantsService } from '../../participants/index.js';
import { participantOnboardingService } from '../../participant-onboarding/index.js';
import { directoryService } from '../../directory/index.js';
import { cryptoKeysService } from '../../crypto-keys/index.js';
import { transactionsOrchestrator } from '../../transactions/index.js';
import { ledgerService, accountCodeFor } from '../../ledger/index.js';
import {
  foreignRailsService,
  _resetSimulatorState
} from '../../crossborder-rails/index.js';
import { crossborderFxService } from '../../crossborder-fx/index.js';
import {
  crossborderTxService,
  crossborderTxRecoveryWorker,
  STATES
} from '../index.js';

const ORIG = 'XB_BANK_O';
const FOREIGN_PARTICIPANT = 'XB_PAPSS_FAKE';
const FOREIGN_RAIL_CODE = 'PAPSS_TX_TEST';

const cleanup = async () => {
  await query(`DELETE FROM crossborder_transactions`);
  await query(`DELETE FROM fx_quotes`);
  await query(`DELETE FROM fx_market_makers`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [ORIG, FOREIGN_PARTICIPANT]);
  await query(`DELETE FROM ledger_accounts`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'xb-%'`);
  await query(`DELETE FROM foreign_rails`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [ORIG, FOREIGN_PARTICIPANT]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, FOREIGN_PARTICIPANT]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ORIG, FOREIGN_PARTICIPANT]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ORIG, FOREIGN_PARTICIPANT]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'crossborder.%' OR event_type LIKE 'fx.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'foreign_rail.%'`);
  await query(`DELETE FROM fee_schedules`);
  await query(`DELETE FROM participants WHERE code IN ($1,$2)`, [ORIG, FOREIGN_PARTICIPANT]);
};

const onboardActiveBank = async (code) => {
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

const seedForeignRail = async () =>
  foreignRailsService.register({
    railCode: FOREIGN_RAIL_CODE,
    railName: 'PAPSS Test',
    railType: 'MULTILATERAL_HUB',
    participantCode: FOREIGN_PARTICIPANT,
    supportedCurrencies: ['NGN', 'KES'],
    supportedCountries: ['NG', 'KE'],
    settlementModel: 'NET_DAILY',
    endpoints: {
      quote: 'http://in-process/simulator-foreign/quote',
      instruct: 'http://in-process/simulator-foreign/instruct',
      status: 'http://in-process/simulator-foreign/status',
      freeze: 'http://in-process/simulator-foreign/freeze',
      reverse: 'http://in-process/simulator-foreign/reverse'
    },
    metadata: { useInProcessSimulator: true }
  });

const seedFxMaker = () =>
  crossborderFxService.registerMaker({
    makerCode: 'XBTX_FAKE_MAKER',
    makerName: 'Fake', supportedPairs: ['GHS/NGN', 'GHS/KES'],
    endpoints: { quote: 'http://localhost:0/fake' },
    priority: 100
  });

beforeAll(async () => {
  await cleanup();
  await onboardActiveBank(ORIG);
  await participantsService.create({
    code: FOREIGN_PARTICIPANT,
    name: 'PAPSS', legalName: 'PAPSS PLC',
    type: 'FOREIGN_RAIL', countryCode: 'NG'
  });
  // Foreign rails skip the standard KYB onboarding — they're regulated
  // entities already, registered under inter-rail bilateral agreements.
  // Force-active for the test.
  await query(`UPDATE participants SET status = 'active' WHERE code = $1`, [FOREIGN_PARTICIPANT]);
  await directoryService.register({
    participantCode: ORIG, accountType: 'BANK_ACCOUNT',
    accountNumber: '0XO0000001', accountName: 'XB Originator', currency: 'GHS'
  });
  await cryptoKeysService.ensureRailKey();
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM crossborder_transactions`);
  await query(`DELETE FROM fx_quotes`);
  await query(`DELETE FROM fx_market_makers`);
  await query(`DELETE FROM transaction_receipts`);
  await query(`DELETE FROM transaction_status_history`);
  await query(`DELETE FROM watchlist_screenings`);
  await query(`DELETE FROM transaction_fraud_signals`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions`);
  await query(`DELETE FROM transactions`);
  await query(`DELETE FROM envelopes WHERE source_message_id LIKE 'xb-%'`);
  await query(`DELETE FROM foreign_rails`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'transaction.%' OR event_type LIKE 'envelope.%' OR event_type LIKE 'crossborder.%' OR event_type LIKE 'fx.%' OR event_type LIKE 'ledger.%' OR event_type LIKE 'foreign_rail.%'`);
  _resetSimulatorState();
  await seedForeignRail();
  await seedFxMaker();
});

const buildXbEnvelope = ({ quote, beneficiaryAccountId = '9999100001', overrides = {} } = {}) =>
  createEnvelope({
    msgType: 'XB_CRDT_TRF',
    sourceFormat: 'REST',
    sourceMessageId: `xb-${Date.now()}-${Math.random()}`,
    endToEndId: `xb-e2e-${Date.now()}-${Math.random()}`,
    idempotencyKey: `xb-idem-${Date.now()}-${Math.random()}-12345678`,
    originator: { participantCode: ORIG, accountId: '0XO0000001', accountType: 'BANK_ACCOUNT', name: 'Kofi Sender', countryCode: 'GH' },
    beneficiary: { participantCode: FOREIGN_PARTICIPANT, accountId: beneficiaryAccountId, accountType: 'BANK_ACCOUNT', name: 'Adaeze', countryCode: 'NG' },
    amount: { value: String(quote.pay_amount_minor), currency: quote.pay_currency },
    crossBorder: {
      foreignRailCode: FOREIGN_RAIL_CODE,
      originatorCountry: 'GH',
      beneficiaryCountry: 'NG',
      fx: {
        payCurrency: quote.pay_currency,
        receiveCurrency: quote.receive_currency,
        lockedRate: quote.rate_decimal_str,
        lockedAt: new Date().toISOString(),
        lockExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        quoteId: quote.id,
        payAmount: String(quote.pay_amount_minor),
        receiveAmount: String(quote.receive_amount_minor)
      },
      travelRule: {
        originatorIdType: 'GHANACARD',
        originatorIdHashed: 'sha256:' + 'a'.repeat(64),
        originatorAddress: 'Accra, GH',
        originatorDateOfBirth: '1990-01-01',
        beneficiaryIdType: 'NATIONAL_ID',
        beneficiaryIdHashed: 'sha256:' + 'b'.repeat(64),
        beneficiaryAddress: 'Lagos, NG',
        purposeOfPayment: 'REMITTANCE_FAMILY',
        jurisdictionOfOriginator: 'GH',
        jurisdictionOfBeneficiary: 'NG'
      },
      settlementAssetType: 'LOCAL_CURRENCY_NET'
    },
    ...overrides
  });

const balances = async () => {
  const fxNostroPay = accountCodeFor({ accountType: 'RAIL_FX_NOSTRO', currency: 'GHS' });
  const fxNostroRecv = accountCodeFor({ accountType: 'RAIL_FX_NOSTRO', currency: 'NGN' });
  const foreignNostro = accountCodeFor({ accountType: 'RAIL_FOREIGN_RAIL_NOSTRO', ownerId: FOREIGN_RAIL_CODE, currency: 'NGN' });
  const origPset = accountCodeFor({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: ORIG, currency: 'GHS' });
  return {
    fxNostroPay: await ledgerService.balanceFor(fxNostroPay),
    fxNostroRecv: await ledgerService.balanceFor(fxNostroRecv),
    foreignNostro: await ledgerService.balanceFor(foreignNostro),
    origPset: await ledgerService.balanceFor(origPset)
  };
};

describe('crossborder-tx — happy path', () => {
  it('quote → ingest XB envelope → both ledger legs commit; recovery ACCEPTED → CONFIRMED', async () => {
    const q = await crossborderFxService.quote({
      payCurrency: 'GHS', receiveCurrency: 'NGN', payAmount: '10000'
    });
    const env = buildXbEnvelope({ quote: q, beneficiaryAccountId: '9999100001' });
    const r = await transactionsOrchestrator.process(env);

    // Parent transaction sits in CREDIT_LEG_PENDING; both ledger legs already
    // committed. Recovery worker promotes to CONFIRMED.
    expect(r.transaction.state).toBe('CREDIT_LEG_PENDING');
    expect(r.crossborder?.state).toBe(STATES.FOREIGN_INSTRUCTING);

    const beforeBalances = await balances();
    expect(beforeBalances.origPset).toBe(-10000n);          // DR originator
    expect(beforeBalances.fxNostroPay).toBe(10000n);         // CR rail FX nostro pay-side
    expect(beforeBalances.fxNostroRecv).toBe(-154200n);      // DR rail FX nostro recv-side
    expect(beforeBalances.foreignNostro).toBe(154200n);      // CR foreign rail nostro

    const tick = await crossborderTxRecoveryWorker.tick();
    expect(tick.picked).toBe(1);
    expect(tick.results[0].terminal).toBe(true);
    expect(tick.results[0].state).toBe(STATES.CONFIRMED);

    const xb = await crossborderTxService.findByTxId(r.transaction.id);
    expect(xb.state).toBe(STATES.CONFIRMED);
    expect(xb.foreign_tx_id).toBeTruthy();
  });
});

describe('crossborder-tx — foreign rail rejects', () => {
  it('REJECTED outcome posts compensating ledger journals + parent tx → REJECTED', async () => {
    const q = await crossborderFxService.quote({
      payCurrency: 'GHS', receiveCurrency: 'NGN', payAmount: '8000'
    });
    const env = buildXbEnvelope({ quote: q, beneficiaryAccountId: '9999100002' }); // AC04
    const r = await transactionsOrchestrator.process(env);
    expect(r.transaction.state).toBe('CREDIT_LEG_PENDING');

    const tick = await crossborderTxRecoveryWorker.tick();
    expect(tick.results[0].state).toBe(STATES.REJECTED);

    const after = await balances();
    expect(after.origPset).toBe(0n);          // compensated back
    expect(after.fxNostroPay).toBe(0n);
    expect(after.fxNostroRecv).toBe(0n);
    expect(after.foreignNostro).toBe(0n);

    // Parent tx is REJECTED.
    const txAfter = await query(`SELECT state, reason_code FROM transactions WHERE id = $1`, [r.transaction.id]);
    expect(txAfter.rows[0].state).toBe('REJECTED');
    expect(txAfter.rows[0].reason_code).toBe('XB_AC04');
  });
});

describe('crossborder-tx — foreign rail timeout → recovery exhausts', () => {
  it('TIMEOUT account 9999100007 retries then FAILED with reversal_needed audit', async () => {
    const q = await crossborderFxService.quote({
      payCurrency: 'GHS', receiveCurrency: 'NGN', payAmount: '5000'
    });
    const env = buildXbEnvelope({ quote: q, beneficiaryAccountId: '9999100007' });
    await transactionsOrchestrator.process(env);
    // Drive recovery to exhaustion — fast-forward attempts directly so we don't
    // wait for the real backoff.
    const xb = await query(`SELECT id FROM crossborder_transactions LIMIT 1`);
    const xbId = xb.rows[0].id;
    for (let i = 0; i < 5; i += 1) {
      await query(`UPDATE crossborder_transactions SET next_attempt_at = NULL WHERE id = $1`, [xbId]);
      await crossborderTxRecoveryWorker.tick();
    }
    const final = await query(`SELECT state, attempts FROM crossborder_transactions WHERE id = $1`, [xbId]);
    expect(final.rows[0].state).toBe(STATES.FAILED);
    const audit = await query(
      `SELECT event_type FROM audit_events WHERE resource_id = $1 AND event_type IN ('crossborder.failed', 'crossborder.reversal_needed')`,
      [xbId]
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe('crossborder-tx — FX expired between quote and instruct', () => {
  it('rejects when the FX quote has expired before envelope ingestion', async () => {
    const q = await crossborderFxService.quote({
      payCurrency: 'GHS', receiveCurrency: 'NGN', payAmount: '5000'
    });
    // Force quote expiry + push lockExpiresAt forward in the envelope so the
    // factory passes the timing check; the coordinator will then catch the
    // DB-level expiration.
    await query(`UPDATE fx_quotes SET expires_at = now() - interval '1 minute' WHERE id = $1`, [q.id]);

    const env = buildXbEnvelope({ quote: q });
    const r = await transactionsOrchestrator.process(env);
    expect(r.transaction.state).toBe('REJECTED');
    expect(r.transaction.reason_code).toMatch(/^XB_/);
    expect(r.crossborderError?.message).toMatch(/FX_QUOTE_EXPIRED/);
  });
});

describe('crossborder-tx — ledger journals balance per currency', () => {
  it('each leg journal balances DR=CR within its currency', async () => {
    const q = await crossborderFxService.quote({
      payCurrency: 'GHS', receiveCurrency: 'NGN', payAmount: '10000'
    });
    const env = buildXbEnvelope({ quote: q });
    await transactionsOrchestrator.process(env);

    const legs = await query(
      `SELECT j.id, j.reason, p.account_code, p.side, p.amount_value, p.currency
         FROM ledger_journal j
         JOIN ledger_postings p ON p.journal_id = j.id
        WHERE j.reason IN ('XB_LEG_1', 'XB_LEG_2')
        ORDER BY j.reason, p.posting_seq`
    );
    expect(legs.rows.length).toBe(4);
    // Group by journal id and verify each balances per currency.
    const byJournal = new Map();
    for (const row of legs.rows) {
      if (!byJournal.has(row.id)) byJournal.set(row.id, []);
      byJournal.get(row.id).push(row);
    }
    for (const entries of byJournal.values()) {
      const ccy = entries[0].currency;
      let dr = 0n; let cr = 0n;
      for (const e of entries) {
        if (e.side === 'DR') dr += BigInt(e.amount_value);
        else cr += BigInt(e.amount_value);
        expect(e.currency).toBe(ccy);
      }
      expect(dr).toBe(cr);
    }
  });
});
