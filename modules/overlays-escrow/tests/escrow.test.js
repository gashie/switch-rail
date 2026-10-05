import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { participantsService } from '../../participants/index.js';
import { participantOnboardingService } from '../../participant-onboarding/index.js';
import { directoryService } from '../../directory/index.js';
import { ledgerService, accountCodeFor } from '../../ledger/index.js';
import { uuidv7 } from '../../../core/uuid.js';
import { overlaysEscrowService, STATES } from '../index.js';

const PAYER = 'ESC_PAYER';
const PAYEE = 'ESC_PAYEE';

const cleanup = async () => {
  await query(`DELETE FROM escrow_holds`);
  await query(`DELETE FROM escrow_sequence`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [PAYER, PAYEE]);
  await query(`DELETE FROM ledger_accounts`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [PAYER, PAYEE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [PAYER, PAYEE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [PAYER, PAYEE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [PAYER, PAYEE]);
  await query(`DELETE FROM users WHERE email LIKE 'esc-%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'escrow.%' OR event_type LIKE 'ledger.%'`);
  await query(`DELETE FROM participants WHERE code IN ($1,$2)`, [PAYER, PAYEE]);
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

beforeAll(async () => {
  await cleanup();
  await onboardActive(PAYER);
  await onboardActive(PAYEE);
  await directoryService.register({ participantCode: PAYER, accountType: 'BANK_ACCOUNT', accountNumber: '0EP0000001', accountName: 'Payer', currency: 'GHS' });
  await directoryService.register({ participantCode: PAYEE, accountType: 'BANK_ACCOUNT', accountNumber: '0EE0000001', accountName: 'Payee', currency: 'GHS' });
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM escrow_holds`);
  await query(`DELETE FROM escrow_sequence`);
  await query(`DELETE FROM ledger_postings`);
  await query(`DELETE FROM ledger_journal`);
  await query(`DELETE FROM settlement_positions`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'escrow.%' OR event_type LIKE 'ledger.%'`);
});

const balances = async () => {
  const escrowCode = accountCodeFor({ accountType: 'RAIL_ESCROW', currency: 'GHS' });
  const payerCode = accountCodeFor({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: PAYER, currency: 'GHS' });
  const payeeCode = accountCodeFor({ accountType: 'PARTICIPANT_SETTLEMENT', ownerId: PAYEE, currency: 'GHS' });
  return {
    escrow: await ledgerService.balanceFor(escrowCode),
    payer: await ledgerService.balanceFor(payerCode),
    payee: await ledgerService.balanceFor(payeeCode)
  };
};

const create = (overrides = {}) =>
  overlaysEscrowService.create({
    payerParticipant: PAYER,
    payerAccountNumber: '0EP0000001',
    payerName: 'Kofi Payer',
    payeeParticipant: PAYEE,
    payeeAccountNumber: '0EE0000001',
    amountMinor: '10000',
    currency: 'GHS',
    releaseCondition: 'BOTH_SIGNATURES',
    ...overrides
  });

describe('overlays-escrow — hold + BOTH_SIGNATURES release', () => {
  it('hold posts DR payer, CR RAIL_ESCROW; both sign → release posts the inverse', async () => {
    const e = await create();
    expect(e.state).toBe(STATES.HELD);
    const heldBalances = await balances();
    expect(heldBalances.escrow).toBe(10000n);
    expect(heldBalances.payer).toBe(-10000n);
    expect(heldBalances.payee).toBe(0n);

    await overlaysEscrowService.sign({ escrowNumber: e.escrow_number, signedBy: 'PAYER' });
    const after1 = await overlaysEscrowService.findByNumber(e.escrow_number);
    expect(after1.state).toBe(STATES.HELD);
    const after = await overlaysEscrowService.sign({ escrowNumber: e.escrow_number, signedBy: 'PAYEE' });
    expect(after.state).toBe(STATES.RELEASED);

    const releasedBalances = await balances();
    expect(releasedBalances.escrow).toBe(0n);
    expect(releasedBalances.payer).toBe(-10000n);
    expect(releasedBalances.payee).toBe(10000n);
  });
});

describe('overlays-escrow — TIME_ELAPSED', () => {
  it('worker tick releases due TIME_ELAPSED holds', async () => {
    const e = await create({
      releaseCondition: 'TIME_ELAPSED',
      releaseAt: new Date(Date.now() + 60_000).toISOString()
    });
    // Push the deadline to the past.
    await query(`UPDATE escrow_holds SET release_at = now() - interval '1 minute' WHERE id = $1`, [e.id]);
    const out = await overlaysEscrowService.tick();
    expect(out.picked).toBe(1);
    expect(out.results[0].ok).toBe(true);
    const after = await overlaysEscrowService.findByNumber(e.escrow_number);
    expect(after.state).toBe(STATES.RELEASED);
  });
});

describe('overlays-escrow — PAYER_RELEASE', () => {
  it('payer alone can release', async () => {
    const e = await create({ releaseCondition: 'PAYER_RELEASE' });
    const r = await overlaysEscrowService.payerRelease({ escrowNumber: e.escrow_number });
    expect(r.state).toBe(STATES.RELEASED);
  });
});

describe('overlays-escrow — ARBITER_RELEASE', () => {
  it('only the designated arbiter can call', async () => {
    const arbiterId = uuidv7();
    const intruderId = uuidv7();
    await query(
      `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, 'x', 'Arbiter'), ($3, $4, 'x', 'Intruder')`,
      [arbiterId, `esc-arb-${arbiterId}@x.gh`, intruderId, `esc-int-${intruderId}@x.gh`]
    );
    const e = await create({ releaseCondition: 'ARBITER_RELEASE', arbiterUserId: arbiterId });
    await expect(
      overlaysEscrowService.arbiterRelease({
        escrowNumber: e.escrow_number,
        arbiterUserId: intruderId
      })
    ).rejects.toThrow(/not the designated arbiter/);
    const r = await overlaysEscrowService.arbiterRelease({
      escrowNumber: e.escrow_number,
      arbiterUserId: arbiterId
    });
    expect(r.state).toBe(STATES.RELEASED);
  });
});

describe('overlays-escrow — refund / cancel', () => {
  it('refund returns funds to payer', async () => {
    const e = await create({ releaseCondition: 'PAYER_RELEASE' });
    const before = await balances();
    expect(before.escrow).toBe(10000n);
    expect(before.payer).toBe(-10000n);
    const r = await overlaysEscrowService.refund({ escrowNumber: e.escrow_number, reason: 'changed mind' });
    expect(r.state).toBe(STATES.REFUNDED);
    const after = await balances();
    expect(after.escrow).toBe(0n);
    expect(after.payer).toBe(0n);
    expect(after.payee).toBe(0n);
  });
});
