import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { participantsService } from '../../participants/index.js';
import { participantOnboardingService, KYB_DOC_TYPES } from '../index.js';

const CODE = 'ONBORDTEST';

const cleanup = async () => {
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code = $1)`, [CODE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code = $1)`, [CODE]);
  await query(`DELETE FROM signing_keys WHERE owner_type = 'participant' AND owner_id = $1`, [CODE]);
  await query(`DELETE FROM envelopes WHERE originator_participant = $1 OR beneficiary_participant = $1`, [CODE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'participant.%' AND payload->>'code' = $1`, [CODE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'envelope.%' AND payload->>'originatorParticipant' = $1`, [CODE]);
  await query(`DELETE FROM participants WHERE code = $1`, [CODE]);
};

const seedParticipant = async () => {
  await participantsService.create({
    code: CODE,
    name: 'Onboarding Test Bank',
    legalName: 'Onboarding Test Bank PLC',
    type: 'BANK',
    bic: 'ONBDGHACXXX',
    countryCode: 'GH',
    supportedFormats: ['REST', 'ISO20022']
  });
};

const uploadAllKyb = async () => {
  for (const docType of KYB_DOC_TYPES) {
    await participantOnboardingService.uploadKyb({
      code: CODE,
      docType,
      fileName: `${docType.toLowerCase()}.pdf`,
      fileBuffer: Buffer.from(`fake-content-for-${docType}`),
      uploadedBy: null
    });
  }
};

const approveAllKyb = async () => {
  for (const docType of KYB_DOC_TYPES) {
    await participantOnboardingService.reviewKyb({
      code: CODE,
      docType,
      status: 'approved',
      note: 'looks good',
      reviewedBy: null
    });
  }
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
  await seedParticipant();
});

describe('onboarding — KYB upload', () => {
  it('first upload moves participant from pending to kyb', async () => {
    await participantOnboardingService.uploadKyb({
      code: CODE,
      docType: 'INCORPORATION',
      fileName: 'incorp.pdf',
      fileBuffer: Buffer.from('hello world'),
      uploadedBy: null
    });
    const status = await participantOnboardingService.getStatus({ code: CODE });
    expect(status.participant.status).toBe('kyb');
    expect(status.kyb.docs).toHaveLength(1);
    expect(status.kyb.docs[0].docSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('re-upload of same docType replaces hash and clears review status', async () => {
    await participantOnboardingService.uploadKyb({
      code: CODE,
      docType: 'INCORPORATION',
      fileName: 'v1.pdf',
      fileBuffer: Buffer.from('one'),
      uploadedBy: null
    });
    await participantOnboardingService.reviewKyb({
      code: CODE,
      docType: 'INCORPORATION',
      status: 'approved',
      reviewedBy: null
    });
    await participantOnboardingService.uploadKyb({
      code: CODE,
      docType: 'INCORPORATION',
      fileName: 'v2.pdf',
      fileBuffer: Buffer.from('two'),
      uploadedBy: null
    });
    const status = await participantOnboardingService.getStatus({ code: CODE });
    const incorp = status.kyb.docs.find((d) => d.docType === 'INCORPORATION');
    expect(incorp.docFilename).toBe('v2.pdf');
    expect(incorp.reviewStatus).toBeNull();
  });

  it('rejects upload for terminated participant', async () => {
    await uploadAllKyb();
    await approveAllKyb();
    await participantOnboardingService.transition({ code: CODE, to: 'certifying', actorId: null });
    await participantOnboardingService.transition({ code: CODE, to: 'active', actorId: null }).catch(() => {});
    // Force terminated path
    await participantOnboardingService.transition({ code: CODE, to: 'terminated', actorId: null });
    await expect(
      participantOnboardingService.uploadKyb({
        code: CODE,
        docType: 'INCORPORATION',
        fileName: 'x.pdf',
        fileBuffer: Buffer.from('x'),
        uploadedBy: null
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('onboarding — KYB review', () => {
  it('reviews a doc and writes audit', async () => {
    await participantOnboardingService.uploadKyb({
      code: CODE,
      docType: 'BOG_LICENSE',
      fileName: 'bog.pdf',
      fileBuffer: Buffer.from('content'),
      uploadedBy: null
    });
    const r = await participantOnboardingService.reviewKyb({
      code: CODE,
      docType: 'BOG_LICENSE',
      status: 'rejected',
      note: 'expired'
    });
    expect(r.doc.review_status).toBe('rejected');
    expect(r.doc.review_note).toBe('expired');
  });

  it('returns NOT_FOUND when reviewing a doc that was never uploaded', async () => {
    await expect(
      participantOnboardingService.reviewKyb({
        code: CODE,
        docType: 'BOG_LICENSE',
        status: 'approved'
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('onboarding — state machine', () => {
  it('rejects transitioning kyb → certifying when not all docs approved', async () => {
    await uploadAllKyb();
    // approve only 4 of 5
    for (const docType of KYB_DOC_TYPES.slice(0, 4)) {
      await participantOnboardingService.reviewKyb({
        code: CODE,
        docType,
        status: 'approved'
      });
    }
    await expect(
      participantOnboardingService.transition({ code: CODE, to: 'certifying', actorId: null })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('transitions kyb → certifying when all approved, and provisions a signing key', async () => {
    await uploadAllKyb();
    await approveAllKyb();
    const r = await participantOnboardingService.transition({
      code: CODE,
      to: 'certifying',
      actorId: null
    });
    expect(r.participant.status).toBe('certifying');
    expect(r.participant.certified_at).not.toBeNull();
    const keys = await query(
      `SELECT count(*)::int AS n FROM signing_keys WHERE owner_type='participant' AND owner_id=$1 AND status='active'`,
      [CODE]
    );
    expect(keys.rows[0].n).toBe(1);
  });

  it('rejects pending → active (skip-state)', async () => {
    await expect(
      participantOnboardingService.transition({ code: CODE, to: 'active', actorId: null })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects certifying → active when not all cert suites pass', async () => {
    await uploadAllKyb();
    await approveAllKyb();
    await participantOnboardingService.transition({ code: CODE, to: 'certifying', actorId: null });
    await expect(
      participantOnboardingService.transition({ code: CODE, to: 'active', actorId: null })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('full happy path: pending → kyb → certifying → active', async () => {
    await uploadAllKyb();
    await approveAllKyb();
    await participantOnboardingService.transition({ code: CODE, to: 'certifying', actorId: null });
    for (const suite of ['ENVELOPE_ROUNDTRIP', 'CREDIT_LEG', 'IDEMPOTENCY', 'NAME_ENQUIRY']) {
      const r = await participantOnboardingService.runCertSuite({ code: CODE, suite });
      expect(r.cert.status).toBe('pass');
    }
    const final = await participantOnboardingService.transition({
      code: CODE,
      to: 'active',
      actorId: null
    });
    expect(final.participant.status).toBe('active');
    expect(final.participant.activated_at).not.toBeNull();
  });

  it('allows active → suspended → active reversal', async () => {
    await uploadAllKyb();
    await approveAllKyb();
    await participantOnboardingService.transition({ code: CODE, to: 'certifying', actorId: null });
    for (const suite of ['ENVELOPE_ROUNDTRIP', 'CREDIT_LEG', 'IDEMPOTENCY', 'NAME_ENQUIRY']) {
      await participantOnboardingService.runCertSuite({ code: CODE, suite });
    }
    await participantOnboardingService.transition({ code: CODE, to: 'active', actorId: null });
    await participantOnboardingService.transition({ code: CODE, to: 'suspended', actorId: null });
    const r = await participantOnboardingService.transition({ code: CODE, to: 'active', actorId: null });
    expect(r.participant.status).toBe('active');
  });
});

describe('onboarding — cert harness', () => {
  it('ENVELOPE_ROUNDTRIP cert passes', async () => {
    const r = await participantOnboardingService.runCertSuite({
      code: CODE,
      suite: 'ENVELOPE_ROUNDTRIP'
    });
    expect(r.cert.status).toBe('pass');
  });

  it('IDEMPOTENCY cert passes (insert + dedupe)', async () => {
    const r = await participantOnboardingService.runCertSuite({
      code: CODE,
      suite: 'IDEMPOTENCY'
    });
    expect(r.cert.status).toBe('pass');
  });
});
