import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { createEnvelope, envelopeService } from '../index.js';

const baseInput = (overrides = {}) => ({
  msgType: 'CRDT_TRF',
  sourceFormat: 'REST',
  sourceMessageId: 'msg-001',
  endToEndId: 'e2e-001',
  idempotencyKey: 'idem-key-aaaaaaa1',
  originator: {
    participantCode: 'BANK01',
    accountId: '0123456789',
    accountType: 'BANK_ACCOUNT',
    name: 'KOFI MENSAH',
    countryCode: 'GH'
  },
  beneficiary: {
    participantCode: 'BANK02',
    accountId: '9876543210',
    accountType: 'BANK_ACCOUNT',
    name: 'AMA OWUSU',
    countryCode: 'GH'
  },
  amount: { value: '15000', currency: 'GHS' },
  ...overrides
});

beforeAll(async () => {
  await query(`DELETE FROM envelopes`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'envelope.%'`);
});

afterAll(async () => {
  await query(`DELETE FROM envelopes`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'envelope.%'`);
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM envelopes`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'envelope.%'`);
});

describe('envelope persistence — ingest', () => {
  it('persists a new envelope and returns deduped=false', async () => {
    const env = createEnvelope(baseInput());
    const r = await envelopeService.ingest(env);
    expect(r.deduped).toBe(false);
    expect(r.envelope.envelopeId).toBe(env.envelopeId);

    const row = await query(`SELECT envelope_id FROM envelopes WHERE envelope_id = $1`, [env.envelopeId]);
    expect(row.rowCount).toBe(1);
  });

  it('writes an envelope.ingested audit event', async () => {
    const env = createEnvelope(baseInput());
    await envelopeService.ingest(env);
    const r = await query(
      `SELECT event_type, resource_id FROM audit_events WHERE event_type = 'envelope.ingested' AND resource_id = $1`,
      [env.envelopeId]
    );
    expect(r.rowCount).toBe(1);
  });
});

describe('envelope persistence — idempotency', () => {
  it('deduplicates an identical resubmission and returns the original envelopeId', async () => {
    const env = createEnvelope(baseInput());
    const first = await envelopeService.ingest(env);

    const dupInput = { ...baseInput(), envelopeId: undefined };
    const dup = createEnvelope(dupInput);
    const second = await envelopeService.ingest(dup);

    expect(second.deduped).toBe(true);
    expect(second.envelope.envelopeId).toBe(first.envelope.envelopeId);

    const r = await query(`SELECT count(*)::int AS n FROM envelopes`);
    expect(r.rows[0].n).toBe(1);
  });

  it('writes an envelope.deduped audit event on duplicate', async () => {
    const env = createEnvelope(baseInput());
    await envelopeService.ingest(env);
    await envelopeService.ingest(createEnvelope({ ...baseInput(), envelopeId: undefined }));

    const r = await query(
      `SELECT count(*)::int AS n FROM audit_events WHERE event_type = 'envelope.deduped'`
    );
    expect(r.rows[0].n).toBe(1);
  });

  it('throws IDEMPOTENCY_CONFLICT when key reused with different content', async () => {
    const a = createEnvelope(baseInput());
    await envelopeService.ingest(a);

    const b = createEnvelope(
      baseInput({ amount: { value: '99999', currency: 'GHS' } })
    );
    await expect(envelopeService.ingest(b)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      status: 409
    });
  });

  it('two concurrent ingests of the same key: one wins, one dedupes', async () => {
    const a = createEnvelope(baseInput());
    const b = createEnvelope({ ...baseInput(), envelopeId: undefined });
    const [r1, r2] = await Promise.all([envelopeService.ingest(a), envelopeService.ingest(b)]);
    const inserted = [r1, r2].filter((r) => !r.deduped);
    const deduped = [r1, r2].filter((r) => r.deduped);
    expect(inserted).toHaveLength(1);
    expect(deduped).toHaveLength(1);

    const rows = await query(`SELECT count(*)::int AS n FROM envelopes`);
    expect(rows.rows[0].n).toBe(1);
  });

  it('different idempotency keys for same originator both persist', async () => {
    const a = createEnvelope(baseInput({ idempotencyKey: 'idem-key-aaaaaaa1' }));
    const b = createEnvelope(baseInput({ idempotencyKey: 'idem-key-bbbbbbb2' }));
    await envelopeService.ingest(a);
    await envelopeService.ingest(b);
    const rows = await query(`SELECT count(*)::int AS n FROM envelopes`);
    expect(rows.rows[0].n).toBe(2);
  });
});

describe('envelope persistence — read', () => {
  it('findByEnvelopeId returns the persisted envelope', async () => {
    const env = createEnvelope(baseInput());
    await envelopeService.ingest(env);
    const found = await envelopeService.findByEnvelopeId(env.envelopeId);
    expect(found.envelopeId).toBe(env.envelopeId);
    expect(found.amount.value).toBe('15000');
  });

  it('findByIdempotencyKey returns the persisted envelope', async () => {
    const env = createEnvelope(baseInput());
    await envelopeService.ingest(env);
    const found = await envelopeService.findByIdempotencyKey('BANK01', 'idem-key-aaaaaaa1');
    expect(found.envelopeId).toBe(env.envelopeId);
  });

  it('list returns persisted envelopes with total', async () => {
    await envelopeService.ingest(createEnvelope(baseInput({ idempotencyKey: 'idem-keyaaaa01' })));
    await envelopeService.ingest(createEnvelope(baseInput({ idempotencyKey: 'idem-keyaaaa02' })));
    const r = await envelopeService.list({ limit: 10, offset: 0 });
    expect(r.total).toBe(2);
    expect(r.rows).toHaveLength(2);
  });
});
