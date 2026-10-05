import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { participantsService } from '../../participants/index.js';
import { participantOnboardingService } from '../../participant-onboarding/index.js';
import { directoryService } from '../../directory/index.js';
import {
  aliasesService,
  aliasesVerificationService,
  aliasesPortabilityService,
  COOLING_PERIOD_MS
} from '../index.js';

const A = 'PORTBANK_A';
const B = 'PORTBANK_B';

const cleanup = async () => {
  await query(`DELETE FROM alias_portability_requests`);
  await query(`DELETE FROM alias_verification_challenges`);
  await query(`DELETE FROM aliases`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1,$2)`, [A, B]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [A, B]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [A, B]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [A, B]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'alias.%' OR event_type LIKE 'directory.%' OR event_type LIKE 'participant.%'`);
  await query(`DELETE FROM settlement_positions WHERE participant_code IN ($1,$2)`, [A, B]);
  await query(`DELETE FROM participants WHERE code IN ($1,$2)`, [A, B]);
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
    await participantOnboardingService.uploadKyb({ code, docType, fileName: `${docType}.pdf`, fileBuffer: Buffer.from('x'), uploadedBy: null });
    await participantOnboardingService.reviewKyb({ code, docType, status: 'approved', reviewedBy: null });
  }
  await participantOnboardingService.transition({ code, to: 'certifying', actorId: null });
  for (const suite of ['ENVELOPE_ROUNDTRIP', 'CREDIT_LEG', 'IDEMPOTENCY', 'NAME_ENQUIRY']) {
    await participantOnboardingService.runCertSuite({ code, suite });
  }
  await participantOnboardingService.transition({ code, to: 'active', actorId: null });
};

const setup = async () => {
  await cleanup();
  await seedActive(A);
  await seedActive(B);
  const acctA = await directoryService.register({
    participantCode: A,
    accountType: 'BANK_ACCOUNT',
    accountNumber: '0100000001',
    accountName: 'Kofi Mensah',
    currency: 'GHS'
  });
  const acctB = await directoryService.register({
    participantCode: B,
    accountType: 'WALLET',
    accountNumber: '0244111111',
    accountName: 'Kofi Mensah',
    currency: 'GHS'
  });
  // Phone alias starts on bank A and gets verified.
  const alias = await aliasesService.register({
    aliasType: 'PHONE',
    aliasValue: '0244555555',
    accountId: acctA.account.id
  });
  const start = await aliasesVerificationService.startOtp({ aliasId: alias.alias.id });
  await aliasesVerificationService.consumeOtp({
    aliasId: alias.alias.id,
    code: start.devCode
  });
  return {
    aliasId: alias.alias.id,
    fromAccountId: acctA.account.id,
    toAccountId: acctB.account.id
  };
};

beforeAll(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

beforeEach(async () => {
  // setup runs per-test
});

describe('aliases — portability happy path', () => {
  it('initiate returns request id + dev OTP code', async () => {
    const { aliasId, toAccountId } = await setup();
    const r = await aliasesPortabilityService.initiate({
      aliasId,
      toParticipant: B,
      toAccountId
    });
    expect(r.request.status).toBe('pending');
    expect(r.devCode).toMatch(/^\d{6}$/);
  });

  it('consent moves alias to the new account and completes the request atomically', async () => {
    const { aliasId, toAccountId } = await setup();
    const init = await aliasesPortabilityService.initiate({
      aliasId,
      toParticipant: B,
      toAccountId
    });
    const out = await aliasesPortabilityService.consent({
      requestId: init.request.id,
      code: init.devCode
    });
    expect(out.alias.account_id).toBe(toAccountId);
    expect(out.alias.participant_code).toBe(B);
    const fresh = await aliasesService.getById(aliasId);
    expect(fresh.account_id).toBe(toAccountId);
    expect(fresh.participant_code).toBe(B);
  });

  it('writes alias.ported audit event', async () => {
    const { aliasId, toAccountId } = await setup();
    const init = await aliasesPortabilityService.initiate({
      aliasId,
      toParticipant: B,
      toAccountId
    });
    await aliasesPortabilityService.consent({
      requestId: init.request.id,
      code: init.devCode
    });
    const r = await query(
      `SELECT count(*)::int AS n FROM audit_events WHERE event_type='alias.ported' AND resource_id=$1`,
      [aliasId]
    );
    expect(r.rows[0].n).toBe(1);
  });
});

describe('aliases — portability rejection paths', () => {
  it('rejects when alias is unverified', async () => {
    const { aliasId, toAccountId } = await setup();
    await query(`UPDATE aliases SET status='pending', verified_at=NULL WHERE id=$1`, [aliasId]);
    await expect(
      aliasesPortabilityService.initiate({
        aliasId,
        toParticipant: B,
        toAccountId
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects when target account does not exist', async () => {
    const { aliasId } = await setup();
    await expect(
      aliasesPortabilityService.initiate({
        aliasId,
        toParticipant: B,
        toAccountId: '00000000-0000-7000-8000-000000000000'
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects when target account participant mismatch', async () => {
    const { aliasId, toAccountId } = await setup();
    await expect(
      aliasesPortabilityService.initiate({
        aliasId,
        toParticipant: A, // wrong — toAccount is on B
        toAccountId
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects within the cooling period', async () => {
    const { aliasId, fromAccountId, toAccountId } = await setup();
    const init = await aliasesPortabilityService.initiate({
      aliasId,
      toParticipant: B,
      toAccountId
    });
    await aliasesPortabilityService.consent({
      requestId: init.request.id,
      code: init.devCode
    });
    // Try to port back immediately — must be blocked.
    await expect(
      aliasesPortabilityService.initiate({
        aliasId,
        toParticipant: A,
        toAccountId: fromAccountId
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('allows porting after the cooling period elapses', async () => {
    const { aliasId, fromAccountId, toAccountId } = await setup();
    const init = await aliasesPortabilityService.initiate({
      aliasId,
      toParticipant: B,
      toAccountId
    });
    await aliasesPortabilityService.consent({
      requestId: init.request.id,
      code: init.devCode
    });
    // Backdate the completion to be older than the cooling window.
    await query(
      `UPDATE alias_portability_requests
         SET completed_at = now() - interval '8 days'
       WHERE alias_id = $1`,
      [aliasId]
    );
    const r = await aliasesPortabilityService.initiate({
      aliasId,
      toParticipant: A,
      toAccountId: fromAccountId
    });
    expect(r.request.status).toBe('pending');
  });

  it('consent rejects wrong code', async () => {
    const { aliasId, toAccountId } = await setup();
    const init = await aliasesPortabilityService.initiate({
      aliasId,
      toParticipant: B,
      toAccountId
    });
    await expect(
      aliasesPortabilityService.consent({ requestId: init.request.id, code: '000000' })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('consent rejects an expired challenge', async () => {
    const { aliasId, toAccountId } = await setup();
    const init = await aliasesPortabilityService.initiate({
      aliasId,
      toParticipant: B,
      toAccountId
    });
    await query(
      `UPDATE alias_portability_requests SET consent_expires_at = now() - interval '1 minute' WHERE id=$1`,
      [init.request.id]
    );
    await expect(
      aliasesPortabilityService.consent({ requestId: init.request.id, code: init.devCode })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('aliases — portability constants', () => {
  it('exposes the 7-day cooling period constant', () => {
    expect(COOLING_PERIOD_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
