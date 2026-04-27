import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { participantsService } from '../../participants/index.js';
import { participantOnboardingService } from '../../participant-onboarding/index.js';
import { directoryService, normalizeName } from '../index.js';

const ACTIVE_CODE = 'DIRBANK01';
const PENDING_CODE = 'DIRBANKPND';

const cleanup = async () => {
  await query(`DELETE FROM accounts WHERE participant_code IN ($1, $2)`, [ACTIVE_CODE, PENDING_CODE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ACTIVE_CODE, PENDING_CODE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [ACTIVE_CODE, PENDING_CODE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [ACTIVE_CODE, PENDING_CODE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'directory.%' OR event_type LIKE 'participant.%'`);
  await query(`DELETE FROM participants WHERE code IN ($1, $2)`, [ACTIVE_CODE, PENDING_CODE]);
};

const seedActiveParticipant = async (code) => {
  await participantsService.create({
    code,
    name: `Bank ${code}`,
    legalName: `Bank ${code} PLC`,
    type: 'BANK',
    countryCode: 'GH'
  });
  for (const docType of ['INCORPORATION', 'BOG_LICENSE', 'TAX_CERT', 'BENEFICIAL_OWNERS', 'AML_POLICY']) {
    await participantOnboardingService.uploadKyb({
      code,
      docType,
      fileName: `${docType}.pdf`,
      fileBuffer: Buffer.from(`x-${docType}`),
      uploadedBy: null
    });
    await participantOnboardingService.reviewKyb({
      code,
      docType,
      status: 'approved',
      reviewedBy: null
    });
  }
  await participantOnboardingService.transition({ code, to: 'certifying', actorId: null });
  for (const suite of ['ENVELOPE_ROUNDTRIP', 'CREDIT_LEG', 'IDEMPOTENCY', 'NAME_ENQUIRY']) {
    await participantOnboardingService.runCertSuite({ code, suite });
  }
  await participantOnboardingService.transition({ code, to: 'active', actorId: null });
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
  await seedActiveParticipant(ACTIVE_CODE);
  await participantsService.create({
    code: PENDING_CODE,
    name: 'Pending Bank',
    legalName: 'Pending Bank PLC',
    type: 'BANK',
    countryCode: 'GH'
  });
});

describe('directory — name normalization', () => {
  it('uppercases, strips diacritics, collapses whitespace', () => {
    expect(normalizeName('  KÔfí   Ménsah  ')).toBe('KOFI MENSAH');
    expect(normalizeName('aké asánte')).toBe('AKE ASANTE');
  });
});

describe('directory — register', () => {
  it('registers an account under an active participant', async () => {
    const r = await directoryService.register({
      participantCode: ACTIVE_CODE,
      accountType: 'BANK_ACCOUNT',
      accountNumber: '0123456789',
      accountName: 'Kofi Ménsah',
      currency: 'GHS'
    });
    expect(r.deduped).toBe(false);
    expect(r.account.account_name_normalized).toBe('KOFI MENSAH');
    expect(r.account.status).toBe('active');
  });

  it('rejects registration when participant is not active', async () => {
    await expect(
      directoryService.register({
        participantCode: PENDING_CODE,
        accountType: 'BANK_ACCOUNT',
        accountNumber: '0000000001',
        accountName: 'Test One',
        currency: 'GHS'
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('idempotently dedupes a same-content re-registration', async () => {
    const a = await directoryService.register({
      participantCode: ACTIVE_CODE,
      accountType: 'BANK_ACCOUNT',
      accountNumber: '0123456789',
      accountName: 'Kofi Mensah',
      currency: 'GHS'
    });
    const b = await directoryService.register({
      participantCode: ACTIVE_CODE,
      accountType: 'BANK_ACCOUNT',
      accountNumber: '0123456789',
      accountName: 'Kofi Mensah',
      currency: 'GHS'
    });
    expect(b.deduped).toBe(true);
    expect(b.account.id).toBe(a.account.id);
  });

  it('throws IDEMPOTENCY_CONFLICT when same key with different account type', async () => {
    await directoryService.register({
      participantCode: ACTIVE_CODE,
      accountType: 'BANK_ACCOUNT',
      accountNumber: '0123456789',
      accountName: 'Kofi Mensah',
      currency: 'GHS'
    });
    await expect(
      directoryService.register({
        participantCode: ACTIVE_CODE,
        accountType: 'WALLET',
        accountNumber: '0123456789',
        accountName: 'Different Name',
        currency: 'GHS'
      })
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});

describe('directory — read', () => {
  it('findByAccount returns the account', async () => {
    await directoryService.register({
      participantCode: ACTIVE_CODE,
      accountType: 'BANK_ACCOUNT',
      accountNumber: '0000000111',
      accountName: 'Ama Owusu',
      currency: 'GHS'
    });
    const a = await directoryService.findByAccount({
      participantCode: ACTIVE_CODE,
      accountNumber: '0000000111'
    });
    expect(a.account_name).toBe('Ama Owusu');
  });

  it('findByAccount throws NOT_FOUND for unknown account', async () => {
    await expect(
      directoryService.findByAccount({
        participantCode: ACTIVE_CODE,
        accountNumber: 'NOPE-9999'
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('searchByName returns fuzzy matches ranked by similarity', async () => {
    await directoryService.register({
      participantCode: ACTIVE_CODE,
      accountType: 'BANK_ACCOUNT',
      accountNumber: '0000000201',
      accountName: 'Kofi Mensah',
      currency: 'GHS'
    });
    await directoryService.register({
      participantCode: ACTIVE_CODE,
      accountType: 'BANK_ACCOUNT',
      accountNumber: '0000000202',
      accountName: 'Kofi Mensah Asante',
      currency: 'GHS'
    });
    await directoryService.register({
      participantCode: ACTIVE_CODE,
      accountType: 'BANK_ACCOUNT',
      accountNumber: '0000000203',
      accountName: 'Ama Owusu',
      currency: 'GHS'
    });
    const matches = await directoryService.searchByName({
      participantCode: ACTIVE_CODE,
      q: 'Kofi Mensa',
      limit: 5
    });
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].account_name_normalized).toContain('KOFI');
  });
});

describe('directory — state transitions', () => {
  const reg = () =>
    directoryService.register({
      participantCode: ACTIVE_CODE,
      accountType: 'BANK_ACCOUNT',
      accountNumber: '0000000301',
      accountName: 'Freeze Test',
      currency: 'GHS'
    });

  it('freeze → unfreeze cycle works', async () => {
    await reg();
    const f = await directoryService.freeze({
      participantCode: ACTIVE_CODE,
      accountNumber: '0000000301'
    });
    expect(f.account.status).toBe('frozen');
    const u = await directoryService.unfreeze({
      participantCode: ACTIVE_CODE,
      accountNumber: '0000000301'
    });
    expect(u.account.status).toBe('active');
  });

  it('cannot unfreeze an active account', async () => {
    await reg();
    await expect(
      directoryService.unfreeze({
        participantCode: ACTIVE_CODE,
        accountNumber: '0000000301'
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('close marks the account closed and sets closed_at', async () => {
    await reg();
    const r = await directoryService.close({
      participantCode: ACTIVE_CODE,
      accountNumber: '0000000301'
    });
    expect(r.account.status).toBe('closed');
    expect(r.account.closed_at).not.toBeNull();
  });

  it('closing an already-closed account is idempotent', async () => {
    await reg();
    await directoryService.close({
      participantCode: ACTIVE_CODE,
      accountNumber: '0000000301'
    });
    const r = await directoryService.close({
      participantCode: ACTIVE_CODE,
      accountNumber: '0000000301'
    });
    expect(r.account.status).toBe('closed');
  });

  it('cannot freeze a closed account', async () => {
    await reg();
    await directoryService.close({
      participantCode: ACTIVE_CODE,
      accountNumber: '0000000301'
    });
    await expect(
      directoryService.freeze({
        participantCode: ACTIVE_CODE,
        accountNumber: '0000000301'
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
