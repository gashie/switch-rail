// Phase 3 cross-module integration test. Exercises the full happy path:
// participant onboarding → account registration → alias registration +
// verification → name-enquiry resolve → CoP scoring across the canonical
// match outcomes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, query } from '../core/db.js';
import { participantsService } from '../modules/participants/index.js';
import { participantOnboardingService } from '../modules/participant-onboarding/index.js';
import { directoryService } from '../modules/directory/index.js';
import {
  aliasesService,
  aliasesVerificationService,
  aliasesPortabilityService
} from '../modules/aliases/index.js';
import {
  nameEnquiryService,
  nameEnquiryCopService
} from '../modules/name-enquiry/index.js';

const A = 'P3I_BANK_A';
const B = 'P3I_BANK_B';

const cleanup = async () => {
  await query(`DELETE FROM alias_portability_requests`);
  await query(`DELETE FROM alias_verification_challenges`);
  await query(`DELETE FROM aliases`);
  await query(`DELETE FROM accounts WHERE participant_code IN ($1, $2)`, [A, B]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [A, B]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code IN ($1,$2))`, [A, B]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id IN ($1,$2)`, [A, B]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'participant.%' OR event_type LIKE 'alias.%' OR event_type LIKE 'directory.%' OR event_type LIKE 'name_enquiry.%' OR event_type LIKE 'cop.%'`);
  await query(`DELETE FROM participants WHERE code IN ($1, $2)`, [A, B]);
};

const onboardActive = async (code, name) => {
  await participantsService.create({
    code,
    name,
    legalName: `${name} PLC`,
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

beforeAll(async () => {
  await cleanup();
  await onboardActive(A, 'Bank A');
  await onboardActive(B, 'Bank B');
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

describe('phase-3 integration: end-to-end directory flow', () => {
  it('completes the full participant → account → alias → resolve → CoP path', async () => {
    // 1. Register an account on Bank A.
    const acctA = await directoryService.register({
      participantCode: A,
      accountType: 'BANK_ACCOUNT',
      accountNumber: '0100000001',
      accountName: 'Kofi Mensah',
      currency: 'GHS'
    });
    expect(acctA.account.status).toBe('active');

    // 2. Register a phone alias and verify via OTP.
    const alias = await aliasesService.register({
      aliasType: 'PHONE',
      aliasValue: '0244111111',
      accountId: acctA.account.id
    });
    expect(alias.alias.status).toBe('pending');
    const start = await aliasesVerificationService.startOtp({ aliasId: alias.alias.id });
    const verified = await aliasesVerificationService.consumeOtp({
      aliasId: alias.alias.id,
      code: start.devCode
    });
    expect(verified.alias.status).toBe('verified');

    // 3. Register a Ghanacard alias and verify via NIA fake.
    const ghanacard = await aliasesService.register({
      aliasType: 'GHANACARD',
      aliasValue: 'GHA-000000001-1',
      accountId: acctA.account.id
    });
    const niaVerified = await aliasesVerificationService.verifyGhanacard({
      aliasId: ghanacard.alias.id
    });
    expect(niaVerified.alias.status).toBe('verified');

    // 4. Resolve via name-enquiry by alias.
    const r1 = await nameEnquiryService.resolve({
      input: { aliasType: 'PHONE', aliasValue: '0244111111' }
    });
    expect(r1.found).toBe(true);
    expect(r1.maskedName).toBe('K**I M****H');

    // 5. CoP exact match.
    const cop1 = await nameEnquiryCopService.cop({
      input: { participantCode: A, accountNumber: '0100000001' },
      suppliedName: 'Kofi Mensah'
    });
    expect(cop1.score).toBe('match');

    // 6. CoP close-match (typo).
    const cop2 = await nameEnquiryCopService.cop({
      input: { participantCode: A, accountNumber: '0100000001' },
      suppliedName: 'Kofi Menseh'
    });
    expect(cop2.score).toBe('close-match');

    // 7. CoP no-match.
    const cop3 = await nameEnquiryCopService.cop({
      input: { participantCode: A, accountNumber: '0100000001' },
      suppliedName: 'Jane Doe'
    });
    expect(cop3.score).toBe('no-match');

    // 8. Port the phone alias to Bank B.
    const acctB = await directoryService.register({
      participantCode: B,
      accountType: 'BANK_ACCOUNT',
      accountNumber: '0200000001',
      accountName: 'Kofi Mensah',
      currency: 'GHS'
    });
    const port = await aliasesPortabilityService.initiate({
      aliasId: alias.alias.id,
      toParticipant: B,
      toAccountId: acctB.account.id
    });
    const ported = await aliasesPortabilityService.consent({
      requestId: port.request.id,
      code: port.devCode
    });
    expect(ported.alias.participant_code).toBe(B);

    // 9. After porting, alias resolves to the new participant.
    const r2 = await nameEnquiryService.resolve({
      input: { aliasType: 'PHONE', aliasValue: '0244111111' }
    });
    expect(r2.participantCode).toBe(B);
    expect(r2.accountNumber).toBe('0200000001');
  });
});
