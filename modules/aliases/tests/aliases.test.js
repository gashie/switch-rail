import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { participantsService } from '../../participants/index.js';
import { participantOnboardingService } from '../../participant-onboarding/index.js';
import { directoryService } from '../../directory/index.js';
import { aliasesService, normalizeAliasValue } from '../index.js';

const CODE_A = 'ALIASBANK_A';
const CODE_B = 'ALIASBANK_B';

const cleanup = async () => {
  await query(`DELETE FROM aliases`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [CODE_A, CODE_B]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [CODE_A, CODE_B]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [CODE_A, CODE_B]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [CODE_A, CODE_B]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'alias.%' OR event_type LIKE 'directory.%' OR event_type LIKE 'participant.%'`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [CODE_A, CODE_B]);
  await query(`DELETE FROM participants WHERE code IN ($1,$2)`, [CODE_A, CODE_B]);
};

const seedActive = async (code) => {
  await participantsService.create({
    code,
    name: `Bank ${code}`,
    legalName: `Bank ${code} PLC`,
    type: 'BANK',
    countryCode: 'GH'
  });
  for (const docType of ['INCORPORATION', 'BOG_LICENSE', 'TAX_CERT', 'BENEFICIAL_OWNERS', 'AML_POLICY']) {
    await participantOnboardingService.uploadKyb({
      code, docType, fileName: `${docType}.pdf`, fileBuffer: Buffer.from('x'), uploadedBy: null
    });
    await participantOnboardingService.reviewKyb({ code, docType, status: 'approved', reviewedBy: null });
  }
  await participantOnboardingService.transition({ code, to: 'certifying', actorId: null });
  for (const suite of ['ENVELOPE_ROUNDTRIP', 'CREDIT_LEG', 'IDEMPOTENCY', 'NAME_ENQUIRY']) {
    await participantOnboardingService.runCertSuite({ code, suite });
  }
  await participantOnboardingService.transition({ code, to: 'active', actorId: null });
};

const registerAccount = (code, accountNumber, name) =>
  directoryService.register({
    participantCode: code,
    accountType: 'BANK_ACCOUNT',
    accountNumber,
    accountName: name,
    currency: 'GHS'
  });

beforeAll(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

beforeEach(async () => {
  await cleanup();
  await seedActive(CODE_A);
  await seedActive(CODE_B);
});

describe('aliases — normalization', () => {
  it('PHONE: local 0-form to E.164 GH', () => {
    expect(normalizeAliasValue('PHONE', '0244123456')).toBe('+233244123456');
    expect(normalizeAliasValue('PHONE', '+233 244 123 456')).toBe('+233244123456');
    expect(normalizeAliasValue('PHONE', '233-244-123456')).toBe('+233244123456');
    expect(normalizeAliasValue('PHONE', '00233244123456')).toBe('+233244123456');
  });

  it('PHONE: rejects invalid input', () => {
    expect(() => normalizeAliasValue('PHONE', 'abc-def')).toThrow(/non-digits|length/);
    expect(() => normalizeAliasValue('PHONE', '12')).toThrow(/length/);
  });

  it('EMAIL: lowercases and validates', () => {
    expect(normalizeAliasValue('EMAIL', '  Kofi@Example.Com ')).toBe('kofi@example.com');
    expect(() => normalizeAliasValue('EMAIL', 'no-at-sign')).toThrow(/email/i);
  });

  it('GHANACARD: enforces GHA-NNNNNNNNN-N', () => {
    expect(normalizeAliasValue('GHANACARD', 'GHA-000000001-1')).toBe('GHA-000000001-1');
    expect(() => normalizeAliasValue('GHANACARD', 'GHA-1-1')).toThrow(/GHA-/);
  });

  it('MERCHANT: uppercases, enforces 6–20 alphanum+dash', () => {
    expect(normalizeAliasValue('MERCHANT', 'shop-001')).toBe('SHOP-001');
    expect(() => normalizeAliasValue('MERCHANT', 'sh!p')).toThrow(/merchant/);
  });

  it('HANDLE: lowercase, rejects reserved words', () => {
    expect(normalizeAliasValue('HANDLE', 'Kofi.Mensah')).toBe('kofi.mensah');
    expect(() => normalizeAliasValue('HANDLE', 'admin')).toThrow(/reserved/);
  });
});

describe('aliases — register', () => {
  let accountIdA;
  beforeEach(async () => {
    const r = await registerAccount(CODE_A, '0000000001', 'Kofi Mensah');
    accountIdA = r.account.id;
  });

  it('registers a phone alias as pending', async () => {
    const r = await aliasesService.register({
      aliasType: 'PHONE',
      aliasValue: '0244123456',
      accountId: accountIdA
    });
    expect(r.deduped).toBe(false);
    expect(r.alias.alias_value).toBe('+233244123456');
    expect(r.alias.status).toBe('pending');
    expect(r.alias.participant_code).toBe(CODE_A);
  });

  it('MERCHANT alias is auto-verified at registration time', async () => {
    const r = await aliasesService.register({
      aliasType: 'MERCHANT',
      aliasValue: 'SHOP-0001',
      accountId: accountIdA
    });
    expect(r.alias.status).toBe('verified');
    expect(r.alias.verification_method).toBe('TIN_FORMAT');
  });

  it('idempotently re-registering same alias to same account returns deduped:true', async () => {
    const a = await aliasesService.register({
      aliasType: 'PHONE',
      aliasValue: '0244123456',
      accountId: accountIdA
    });
    const b = await aliasesService.register({
      aliasType: 'PHONE',
      aliasValue: '0244123456',
      accountId: accountIdA
    });
    expect(b.deduped).toBe(true);
    expect(b.alias.id).toBe(a.alias.id);
  });

  it('rejects registering same alias to a DIFFERENT account', async () => {
    const second = await registerAccount(CODE_B, '0000000002', 'Ama Owusu');
    await aliasesService.register({
      aliasType: 'PHONE',
      aliasValue: '0244123456',
      accountId: accountIdA
    });
    await expect(
      aliasesService.register({
        aliasType: 'PHONE',
        aliasValue: '0244123456',
        accountId: second.account.id
      })
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('after revoke, the same value can be registered fresh to a new account', async () => {
    const a = await aliasesService.register({
      aliasType: 'PHONE',
      aliasValue: '0244123456',
      accountId: accountIdA
    });
    await aliasesService.revoke(a.alias.id);

    const second = await registerAccount(CODE_B, '0000000099', 'Ama Owusu');
    const fresh = await aliasesService.register({
      aliasType: 'PHONE',
      aliasValue: '0244123456',
      accountId: second.account.id
    });
    expect(fresh.deduped).toBe(false);
    expect(fresh.alias.account_id).toBe(second.account.id);
  });

  it('rejects when target account is not active', async () => {
    await directoryService.freeze({ participantCode: CODE_A, accountNumber: '0000000001' });
    await expect(
      aliasesService.register({
        aliasType: 'PHONE',
        aliasValue: '0244123456',
        accountId: accountIdA
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects when target account does not exist', async () => {
    await expect(
      aliasesService.register({
        aliasType: 'PHONE',
        aliasValue: '0244123456',
        accountId: '00000000-0000-7000-8000-000000000000'
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('aliases — resolve / listByAccount / revoke', () => {
  let accountIdA;
  beforeEach(async () => {
    const r = await registerAccount(CODE_A, '0000000010', 'Kofi Mensah');
    accountIdA = r.account.id;
  });

  it('resolve returns null for unknown alias', async () => {
    const r = await aliasesService.resolve({
      aliasType: 'PHONE',
      aliasValue: '0244999999'
    });
    expect(r).toBeNull();
  });

  it('resolve returns null for pending alias (only verified resolves)', async () => {
    await aliasesService.register({
      aliasType: 'PHONE',
      aliasValue: '0244123456',
      accountId: accountIdA
    });
    const r = await aliasesService.resolve({
      aliasType: 'PHONE',
      aliasValue: '0244123456'
    });
    expect(r).toBeNull();
  });

  it('resolve returns alias for verified MERCHANT (auto-verified)', async () => {
    await aliasesService.register({
      aliasType: 'MERCHANT',
      aliasValue: 'SHOP-0001',
      accountId: accountIdA
    });
    const r = await aliasesService.resolve({
      aliasType: 'MERCHANT',
      aliasValue: 'shop-0001'
    });
    expect(r).not.toBeNull();
    expect(r.account_id).toBe(accountIdA);
  });

  it('listByAccount returns aliases for the given account', async () => {
    await aliasesService.register({ aliasType: 'PHONE', aliasValue: '0244123456', accountId: accountIdA });
    await aliasesService.register({ aliasType: 'EMAIL', aliasValue: 'kofi@example.com', accountId: accountIdA });
    const list = await aliasesService.listByAccount(accountIdA);
    expect(list).toHaveLength(2);
  });

  it('revoke marks status=revoked', async () => {
    const r = await aliasesService.register({
      aliasType: 'EMAIL',
      aliasValue: 'kofi@example.com',
      accountId: accountIdA
    });
    const out = await aliasesService.revoke(r.alias.id);
    expect(out.alias.status).toBe('revoked');
    expect(out.alias.revoked_at).not.toBeNull();
  });

  it('revoke is idempotent', async () => {
    const r = await aliasesService.register({
      aliasType: 'EMAIL',
      aliasValue: 'kofi@example.com',
      accountId: accountIdA
    });
    await aliasesService.revoke(r.alias.id);
    const out = await aliasesService.revoke(r.alias.id);
    expect(out.alias.status).toBe('revoked');
  });
});
