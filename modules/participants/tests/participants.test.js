import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { participantsService } from '../index.js';

const baseInput = (overrides = {}) => ({
  code: 'BANK01',
  name: 'Bank One',
  legalName: 'Bank One PLC',
  type: 'BANK',
  bic: 'BANKGHACXXX',
  countryCode: 'GH',
  supportedFormats: ['ISO20022', 'REST'],
  endpoints: { inbound: 'https://bank01.example/inbound' },
  contactEmail: 'ops@bank01.local',
  ...overrides
});

beforeAll(async () => {
  await query(`DELETE FROM participants WHERE code LIKE 'BANK%' OR code LIKE 'WALLET%' OR code LIKE 'TEST%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'participant.%'`);
});

afterAll(async () => {
  await query(`DELETE FROM participants WHERE code LIKE 'BANK%' OR code LIKE 'WALLET%' OR code LIKE 'TEST%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'participant.%'`);
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM participants WHERE code LIKE 'BANK%' OR code LIKE 'WALLET%' OR code LIKE 'TEST%'`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'participant.%'`);
});

describe('participants — create', () => {
  it('creates a new participant in pending state', async () => {
    const r = await participantsService.create(baseInput());
    expect(r.deduped).toBe(false);
    expect(r.participant.code).toBe('BANK01');
    expect(r.participant.status).toBe('pending');
    expect(r.participant.type).toBe('BANK');
    expect(r.participant.bic).toBe('BANKGHACXXX');
  });

  it('writes a participant.created audit event', async () => {
    const r = await participantsService.create(baseInput());
    const evt = await query(
      `SELECT count(*)::int AS n FROM audit_events WHERE event_type = 'participant.created' AND resource_id = $1`,
      [r.participant.id]
    );
    expect(evt.rows[0].n).toBe(1);
  });

  it('idempotently dedupes a re-submission of the same participant', async () => {
    const first = await participantsService.create(baseInput());
    const second = await participantsService.create(baseInput());
    expect(second.deduped).toBe(true);
    expect(second.participant.id).toBe(first.participant.id);
  });

  it('throws IDEMPOTENCY_CONFLICT when same code is reused with different content', async () => {
    await participantsService.create(baseInput());
    await expect(
      participantsService.create(baseInput({ name: 'A Different Name', legalName: 'Different PLC' }))
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
  });
});

describe('participants — getByCode / list', () => {
  it('getByCode returns the participant', async () => {
    await participantsService.create(baseInput());
    const p = await participantsService.getByCode('BANK01');
    expect(p.code).toBe('BANK01');
  });

  it('getByCode throws NOT_FOUND for unknown code', async () => {
    await expect(participantsService.getByCode('TESTNOPE')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404
    });
  });

  it('list filters by type and status', async () => {
    await participantsService.create(baseInput({ code: 'BANK01' }));
    await participantsService.create(
      baseInput({ code: 'WALLET01', name: 'Wallet One', legalName: 'Wallet One Ltd', type: 'WALLET', bic: undefined })
    );
    // Tolerant of pre-existing demo seed data (DEMO_BANK from scripts/seed.js):
    // assert BANK01 is in the list, every returned row has type=BANK, and the
    // WALLET row is excluded.
    const banks = await participantsService.list({ type: 'BANK', limit: 50, offset: 0 });
    expect(banks.rows.find((r) => r.code === 'BANK01')).toBeDefined();
    expect(banks.rows.every((r) => r.type === 'BANK')).toBe(true);
    expect(banks.rows.find((r) => r.code === 'WALLET01')).toBeUndefined();
  });
});

describe('participants — update', () => {
  it('updates allowed fields and writes audit', async () => {
    const created = await participantsService.create(baseInput());
    const before = created.participant.updated_at;
    await new Promise((r) => setTimeout(r, 5));
    const r = await participantsService.update('BANK01', { name: 'Bank One Renamed' });
    expect(r.participant.name).toBe('Bank One Renamed');
    expect(new Date(r.participant.updated_at).getTime()).toBeGreaterThan(new Date(before).getTime());
    const audit = await query(
      `SELECT payload FROM audit_events WHERE event_type = 'participant.updated' AND resource_id = $1`,
      [r.participant.id]
    );
    expect(audit.rows[0].payload.changedFields).toContain('name');
  });

  it('rejects update of unknown participant', async () => {
    await expect(participantsService.update('TESTNOPE', { name: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
  });
});

describe('participants — listKeysFor', () => {
  it('returns an empty list when no keys provisioned yet', async () => {
    await participantsService.create(baseInput());
    const keys = await participantsService.listKeysFor('BANK01');
    expect(Array.isArray(keys)).toBe(true);
    expect(keys).toHaveLength(0);
  });

  it('throws NOT_FOUND when participant does not exist', async () => {
    await expect(participantsService.listKeysFor('TESTGONE')).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
  });
});
