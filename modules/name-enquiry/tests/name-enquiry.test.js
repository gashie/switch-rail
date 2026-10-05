import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import {
  jaroWinkler,
  maskName,
  normalizeForCompare,
  normalizeAndSortTokens,
  tokensSubset
} from '../../../core/strings.js';
import { participantsService } from '../../participants/index.js';
import { participantOnboardingService } from '../../participant-onboarding/index.js';
import { directoryService } from '../../directory/index.js';
import {
  aliasesService,
  aliasesVerificationService
} from '../../aliases/index.js';
import { nameEnquiryService } from '../index.js';

const CODE = 'NEBANK01';
const BIC = 'NEBKGHACXXX';

const cleanup = async () => {
  await query(`DELETE FROM alias_verification_challenges`);
  await query(`DELETE FROM aliases`);
  await query(`DELETE FROM accounts WHERE participant_code = $1`, [CODE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code = $1)`, [CODE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code = $1)`, [CODE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id = $1`, [CODE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'name_enquiry.%' OR event_type LIKE 'alias.%' OR event_type LIKE 'directory.%' OR event_type LIKE 'participant.%'`);
  await query(`DELETE FROM settlement_positions WHERE participant_code = $1`, [CODE]);
  await query(`DELETE FROM participants WHERE code = $1`, [CODE]);
};

const seedActive = async () => {
  await participantsService.create({
    code: CODE,
    name: 'NE Bank One',
    legalName: 'NE Bank One PLC',
    type: 'BANK',
    bic: BIC,
    countryCode: 'GH'
  });
  for (const docType of ['INCORPORATION', 'BOG_LICENSE', 'TAX_CERT', 'BENEFICIAL_OWNERS', 'AML_POLICY']) {
    await participantOnboardingService.uploadKyb({ code: CODE, docType, fileName: `${docType}.pdf`, fileBuffer: Buffer.from('x'), uploadedBy: null });
    await participantOnboardingService.reviewKyb({ code: CODE, docType, status: 'approved', reviewedBy: null });
  }
  await participantOnboardingService.transition({ code: CODE, to: 'certifying', actorId: null });
  for (const suite of ['ENVELOPE_ROUNDTRIP', 'CREDIT_LEG', 'IDEMPOTENCY', 'NAME_ENQUIRY']) {
    await participantOnboardingService.runCertSuite({ code: CODE, suite });
  }
  await participantOnboardingService.transition({ code: CODE, to: 'active', actorId: null });
};

const setup = async () => {
  await cleanup();
  await seedActive();
  const acct = await directoryService.register({
    participantCode: CODE,
    accountType: 'BANK_ACCOUNT',
    accountNumber: '0100000001',
    accountName: 'Kofi Mensah',
    currency: 'GHS'
  });
  const phoneAlias = await aliasesService.register({
    aliasType: 'PHONE',
    aliasValue: '0244111111',
    accountId: acct.account.id
  });
  const start = await aliasesVerificationService.startOtp({ aliasId: phoneAlias.alias.id });
  await aliasesVerificationService.consumeOtp({
    aliasId: phoneAlias.alias.id,
    code: start.devCode
  });
  return { accountId: acct.account.id };
};

beforeAll(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

beforeEach(async () => {
  await setup();
});

describe('core/strings — primitives', () => {
  it('normalizeForCompare uppercases and strips diacritics', () => {
    expect(normalizeForCompare('  KÔfí Ménsah ')).toBe('KOFI MENSAH');
  });

  it('normalizeAndSortTokens makes name comparisons order-independent', () => {
    expect(normalizeAndSortTokens('Mensah Kofi')).toBe(normalizeAndSortTokens('Kofi Mensah'));
  });

  it('maskName preserves first + last letter per word', () => {
    expect(maskName('KOFI MENSAH')).toBe('K**I M****H');
    expect(maskName('AKE')).toBe('A*E');
    expect(maskName('JO')).toBe('J*');
    expect(maskName('X')).toBe('X');
  });

  it('jaroWinkler returns 1 for identical strings', () => {
    expect(jaroWinkler('KOFI MENSAH', 'KOFI MENSAH')).toBe(1);
  });

  it('jaroWinkler handles a single-letter typo with high similarity', () => {
    const score = jaroWinkler('KOFI MENSAH', 'KOFI MENSEH');
    expect(score).toBeGreaterThan(0.9);
    expect(score).toBeLessThan(1);
  });

  it('jaroWinkler returns 0 for empty inputs', () => {
    expect(jaroWinkler('', 'X')).toBe(0);
    expect(jaroWinkler('X', '')).toBe(0);
  });

  it('tokensSubset detects subset relationships either way', () => {
    expect(tokensSubset('KOFI', 'KOFI MENSAH ASANTE')).toBe(true);
    expect(tokensSubset('KOFI MENSAH ASANTE', 'KOFI')).toBe(true);
    expect(tokensSubset('JANE DOE', 'KOFI MENSAH')).toBe(false);
  });
});

describe('name-enquiry — resolve by alias', () => {
  it('returns masked name for an active account via verified phone alias', async () => {
    const r = await nameEnquiryService.resolve({
      input: { aliasType: 'PHONE', aliasValue: '0244111111' }
    });
    expect(r.found).toBe(true);
    expect(r.maskedName).toBe('K**I M****H');
    expect(r.participantCode).toBe(CODE);
    expect(r.accountNumber).toBe('0100000001');
    expect(r.accountType).toBe('BANK_ACCOUNT');
  });

  it('returns found:false for unverified alias', async () => {
    const acct = await directoryService.register({
      participantCode: CODE,
      accountType: 'BANK_ACCOUNT',
      accountNumber: '0100000099',
      accountName: 'Pending Person',
      currency: 'GHS'
    });
    await aliasesService.register({
      aliasType: 'EMAIL',
      aliasValue: 'pending@example.com',
      accountId: acct.account.id
    });
    const r = await nameEnquiryService.resolve({
      input: { aliasType: 'EMAIL', aliasValue: 'pending@example.com' }
    });
    expect(r.found).toBe(false);
  });
});

describe('name-enquiry — resolve by participant + account number', () => {
  it('returns masked name for an active account', async () => {
    const r = await nameEnquiryService.resolve({
      input: { participantCode: CODE, accountNumber: '0100000001' }
    });
    expect(r.found).toBe(true);
    expect(r.maskedName).toBe('K**I M****H');
  });

  it('returns found:false for unknown account number', async () => {
    const r = await nameEnquiryService.resolve({
      input: { participantCode: CODE, accountNumber: '9999999999' }
    });
    expect(r.found).toBe(false);
  });

  it('returns found:false for a frozen account', async () => {
    await directoryService.freeze({
      participantCode: CODE,
      accountNumber: '0100000001'
    });
    const r = await nameEnquiryService.resolve({
      input: { participantCode: CODE, accountNumber: '0100000001' }
    });
    expect(r.found).toBe(false);
  });
});

describe('name-enquiry — resolve by BIC + account number', () => {
  it('resolves via BIC → participant code path', async () => {
    const r = await nameEnquiryService.resolve({
      input: { bic: BIC, accountNumber: '0100000001' }
    });
    expect(r.found).toBe(true);
    expect(r.participantCode).toBe(CODE);
  });

  it('returns found:false for unknown BIC', async () => {
    const r = await nameEnquiryService.resolve({
      input: { bic: 'XXXXGHACXXX', accountNumber: '0100000001' }
    });
    expect(r.found).toBe(false);
  });
});

describe('name-enquiry — audit', () => {
  it('writes a name_enquiry.executed audit event for both found and not-found', async () => {
    await nameEnquiryService.resolve({
      input: { participantCode: CODE, accountNumber: '0100000001' }
    });
    await nameEnquiryService.resolve({
      input: { participantCode: CODE, accountNumber: 'NOTFOUND' }
    });
    const r = await query(
      `SELECT count(*)::int AS n FROM audit_events WHERE event_type='name_enquiry.executed'`
    );
    expect(r.rows[0].n).toBeGreaterThanOrEqual(2);
  });
});
