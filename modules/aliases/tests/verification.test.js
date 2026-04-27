import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { participantsService } from '../../participants/index.js';
import { participantOnboardingService } from '../../participant-onboarding/index.js';
import { directoryService } from '../../directory/index.js';
import {
  aliasesService,
  aliasesVerificationService
} from '../index.js';

const CODE = 'VERIFYBANK';

const cleanup = async () => {
  await query(`DELETE FROM alias_verification_challenges`);
  await query(`DELETE FROM aliases`);
  await query(`DELETE FROM accounts WHERE participant_code = $1`, [CODE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code = $1)`, [CODE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code = $1)`, [CODE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id = $1`, [CODE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'alias.%' OR event_type LIKE 'directory.%' OR event_type LIKE 'participant.%'`);
  await query(`DELETE FROM settlement_positions WHERE participant_code = $1`, [CODE]);
  await query(`DELETE FROM participants WHERE code = $1`, [CODE]);
};

const seedActive = async () => {
  await participantsService.create({
    code: CODE,
    name: 'Verify Bank',
    legalName: 'Verify Bank PLC',
    type: 'BANK',
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

const registerKofi = async () => {
  const acct = await directoryService.register({
    participantCode: CODE,
    accountType: 'BANK_ACCOUNT',
    accountNumber: '0100000001',
    accountName: 'Kofi Mensah',
    currency: 'GHS'
  });
  return acct.account.id;
};

beforeAll(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

beforeEach(async () => {
  await cleanup();
  await seedActive();
});

describe('verification — phone OTP', () => {
  let aliasId;
  let accountId;
  beforeEach(async () => {
    accountId = await registerKofi();
    const r = await aliasesService.register({
      aliasType: 'PHONE',
      aliasValue: '0244111111',
      accountId
    });
    aliasId = r.alias.id;
  });

  it('start returns a 6-digit dev code; consume verifies the alias', async () => {
    const start = await aliasesVerificationService.startOtp({ aliasId });
    expect(start.devCode).toMatch(/^\d{6}$/);
    expect(start.maxAttempts).toBe(3);
    const r = await aliasesVerificationService.consumeOtp({
      aliasId,
      code: start.devCode
    });
    expect(r.alias.status).toBe('verified');
    expect(r.alias.verification_method).toBe('OTP');
  });

  it('rejects wrong code, increments attempts', async () => {
    await aliasesVerificationService.startOtp({ aliasId });
    await expect(
      aliasesVerificationService.consumeOtp({ aliasId, code: '000000' })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const row = await query(`SELECT attempts FROM alias_verification_challenges WHERE alias_id = $1`, [aliasId]);
    expect(row.rows[0].attempts).toBe(1);
  });

  it('after 3 wrong attempts the challenge is consumed', async () => {
    await aliasesVerificationService.startOtp({ aliasId });
    for (let i = 0; i < 3; i++) {
      await aliasesVerificationService.consumeOtp({ aliasId, code: '000000' }).catch(() => {});
    }
    const row = await query(`SELECT consumed_at, attempts FROM alias_verification_challenges WHERE alias_id = $1`, [aliasId]);
    expect(row.rows[0].consumed_at).not.toBeNull();
    await expect(
      aliasesVerificationService.consumeOtp({ aliasId, code: '000000' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects an expired challenge', async () => {
    await aliasesVerificationService.startOtp({ aliasId });
    await query(
      `UPDATE alias_verification_challenges SET expires_at = now() - interval '1 minute' WHERE alias_id = $1`,
      [aliasId]
    );
    await expect(
      aliasesVerificationService.consumeOtp({ aliasId, code: '123456' })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses to start OTP for a non-PHONE alias', async () => {
    const email = await aliasesService.register({
      aliasType: 'EMAIL',
      aliasValue: 'kofi@example.com',
      accountId
    });
    await expect(
      aliasesVerificationService.startOtp({ aliasId: email.alias.id })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('verification — email link', () => {
  let aliasId;
  beforeEach(async () => {
    const accountId = await registerKofi();
    const r = await aliasesService.register({
      aliasType: 'EMAIL',
      aliasValue: 'kofi@example.com',
      accountId
    });
    aliasId = r.alias.id;
  });

  it('start returns a token; consume verifies the alias', async () => {
    const start = await aliasesVerificationService.startEmailLink({ aliasId });
    expect(start.devToken).toMatch(/^[A-Za-z0-9_-]+$/);
    const r = await aliasesVerificationService.consumeEmailLink({
      aliasId,
      token: start.devToken
    });
    expect(r.alias.status).toBe('verified');
    expect(r.alias.verification_method).toBe('EMAIL_LINK');
  });

  it('rejects a wrong token', async () => {
    await aliasesVerificationService.startEmailLink({ aliasId });
    await expect(
      aliasesVerificationService.consumeEmailLink({ aliasId, token: 'wrong-token-12345678' })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects an expired token', async () => {
    const start = await aliasesVerificationService.startEmailLink({ aliasId });
    await query(
      `UPDATE alias_verification_challenges SET expires_at = now() - interval '1 minute' WHERE alias_id = $1`,
      [aliasId]
    );
    await expect(
      aliasesVerificationService.consumeEmailLink({ aliasId, token: start.devToken })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('verification — Ghanacard via NIA fake', () => {
  let kofiAccountId;
  beforeEach(async () => {
    kofiAccountId = await registerKofi();
  });

  it('verifies a Ghanacard PIN that matches the account holder', async () => {
    const r = await aliasesService.register({
      aliasType: 'GHANACARD',
      aliasValue: 'GHA-000000001-1',
      accountId: kofiAccountId
    });
    const out = await aliasesVerificationService.verifyGhanacard({ aliasId: r.alias.id });
    expect(out.alias.status).toBe('verified');
    expect(out.alias.verification_method).toBe('NIA');
  });

  it('rejects a Ghanacard PIN whose NIA name does NOT match the account holder', async () => {
    const r = await aliasesService.register({
      aliasType: 'GHANACARD',
      aliasValue: 'GHA-000000002-2', // belongs to AMA OWUSU per the fake
      accountId: kofiAccountId // account is registered to KOFI MENSAH
    });
    await expect(
      aliasesVerificationService.verifyGhanacard({ aliasId: r.alias.id })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const stillPending = await query(`SELECT status FROM aliases WHERE id = $1`, [r.alias.id]);
    expect(stillPending.rows[0].status).toBe('pending');
  });

  it('returns NOT_FOUND for an unknown Ghanacard PIN', async () => {
    const r = await aliasesService.register({
      aliasType: 'GHANACARD',
      aliasValue: 'GHA-999999999-9',
      accountId: kofiAccountId
    });
    await expect(
      aliasesVerificationService.verifyGhanacard({ aliasId: r.alias.id })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('verification — already-verified short-circuits', () => {
  it('consumeOtp on already-verified alias returns the alias unchanged', async () => {
    const accountId = await registerKofi();
    const r = await aliasesService.register({
      aliasType: 'PHONE',
      aliasValue: '0244111111',
      accountId
    });
    const start = await aliasesVerificationService.startOtp({ aliasId: r.alias.id });
    await aliasesVerificationService.consumeOtp({
      aliasId: r.alias.id,
      code: start.devCode
    });
    const repeat = await aliasesVerificationService.consumeOtp({
      aliasId: r.alias.id,
      code: '000000'
    });
    expect(repeat.alias.status).toBe('verified');
  });
});
