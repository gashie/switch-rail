import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { participantsService } from '../../participants/index.js';
import { participantOnboardingService } from '../../participant-onboarding/index.js';
import { directoryService } from '../../directory/index.js';
import { nameEnquiryCopService, COP_THRESHOLDS } from '../index.js';

const CODE = 'COPBANK01';

const cleanup = async () => {
  await query(`DELETE FROM aliases`);
  await query(`DELETE FROM accounts WHERE participant_code = $1`, [CODE]);
  await query(`DELETE FROM participant_kyb WHERE participant_id IN (SELECT id FROM participants WHERE code = $1)`, [CODE]);
  await query(`DELETE FROM participant_certifications WHERE participant_id IN (SELECT id FROM participants WHERE code = $1)`, [CODE]);
  await query(`DELETE FROM signing_keys WHERE owner_type='participant' AND owner_id = $1`, [CODE]);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'cop.%' OR event_type LIKE 'name_enquiry.%' OR event_type LIKE 'directory.%' OR event_type LIKE 'participant.%'`);
  await query(`DELETE FROM settlement_positions WHERE participant_code = $1`, [CODE]);
  await query(`DELETE FROM participants WHERE code = $1`, [CODE]);
};

const seedActive = async () => {
  await participantsService.create({
    code: CODE,
    name: 'CoP Bank',
    legalName: 'CoP Bank PLC',
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
  await directoryService.register({
    participantCode: CODE,
    accountType: 'BANK_ACCOUNT',
    accountNumber: '0100000001',
    accountName: 'Kofi Mensah Asante',
    currency: 'GHS'
  });
});

describe('CoP — match outcomes', () => {
  it('exact name → match (similarity 1)', async () => {
    const r = await nameEnquiryCopService.cop({
      input: { participantCode: CODE, accountNumber: '0100000001' },
      suppliedName: 'Kofi Mensah Asante'
    });
    expect(r.found).toBe(true);
    expect(r.score).toBe('match');
    expect(r.similarity).toBe(1);
    expect(r.canonicalName).toBeUndefined();
  });

  it('order-independent: tokens reordered → still match', async () => {
    const r = await nameEnquiryCopService.cop({
      input: { participantCode: CODE, accountNumber: '0100000001' },
      suppliedName: 'Mensah Kofi Asante'
    });
    expect(r.score).toBe('match');
  });

  it('case + diacritics + whitespace ignored', async () => {
    const r = await nameEnquiryCopService.cop({
      input: { participantCode: CODE, accountNumber: '0100000001' },
      suppliedName: '  kofi   ménsah    Asante  '
    });
    expect(r.score).toBe('match');
  });

  it('single-letter typo → close-match (≥ 0.92)', async () => {
    const r = await nameEnquiryCopService.cop({
      input: { participantCode: CODE, accountNumber: '0100000001' },
      suppliedName: 'Kofi Menseh Asante'
    });
    expect(r.score).toBe('close-match');
    expect(r.similarity).toBeGreaterThanOrEqual(COP_THRESHOLDS.closeMatch);
    expect(r.canonicalName).toBe('KOFI MENSAH ASANTE');
  });

  it('subset of tokens → partial-match', async () => {
    const r = await nameEnquiryCopService.cop({
      input: { participantCode: CODE, accountNumber: '0100000001' },
      suppliedName: 'Kofi'
    });
    expect(r.score).toBe('partial-match');
    expect(r.canonicalName).toBe('KOFI MENSAH ASANTE');
  });

  it('completely different name → no-match', async () => {
    const r = await nameEnquiryCopService.cop({
      input: { participantCode: CODE, accountNumber: '0100000001' },
      suppliedName: 'Jane Doe'
    });
    expect(r.score).toBe('no-match');
    expect(r.canonicalName).toBeUndefined();
    expect(r.similarity).toBeLessThan(COP_THRESHOLDS.partialMatch);
  });

  it('always returns the masked name regardless of score', async () => {
    const r = await nameEnquiryCopService.cop({
      input: { participantCode: CODE, accountNumber: '0100000001' },
      suppliedName: 'Jane Doe'
    });
    // KOFI MENSAH ASANTE → "K**I M****H A****E"
    expect(r.maskedName).toBe('K**I M****H A****E');
  });
});

describe('CoP — not found', () => {
  it('returns found:false for unknown account', async () => {
    const r = await nameEnquiryCopService.cop({
      input: { participantCode: CODE, accountNumber: 'NOPE' },
      suppliedName: 'anyone'
    });
    expect(r.found).toBe(false);
  });

  it('returns found:false for frozen account', async () => {
    await directoryService.freeze({
      participantCode: CODE,
      accountNumber: '0100000001'
    });
    const r = await nameEnquiryCopService.cop({
      input: { participantCode: CODE, accountNumber: '0100000001' },
      suppliedName: 'Kofi Mensah Asante'
    });
    expect(r.found).toBe(false);
  });
});

describe('CoP — audit', () => {
  it('writes a cop.executed audit event with score + similarity', async () => {
    await nameEnquiryCopService.cop({
      input: { participantCode: CODE, accountNumber: '0100000001' },
      suppliedName: 'Kofi Mensah Asante'
    });
    const r = await query(
      `SELECT payload FROM audit_events WHERE event_type='cop.executed' ORDER BY ts DESC LIMIT 1`
    );
    expect(r.rows[0].payload.score).toBe('match');
    expect(r.rows[0].payload.similarity).toBe(1);
  });
});
