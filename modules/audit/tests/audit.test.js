import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as db from '../../../core/db.js';
import { closePool, query } from '../../../core/db.js';
import { createAuditModel } from '../model.js';
import { createAuditService, formatDayUtc } from '../service.js';

const model = createAuditModel();
const service = createAuditService({ db, model });

const today = formatDayUtc();

beforeAll(async () => {
  await query(`DELETE FROM audit_events`);
});

afterAll(async () => {
  await query(`DELETE FROM audit_events`);
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM audit_events`);
});

describe('audit — record', () => {
  it('records an event and returns the row', async () => {
    const row = await service.record({
      actorType: 'system',
      eventType: 'test.basic',
      payload: { hello: 'world' }
    });
    expect(row.event_type).toBe('test.basic');
    expect(row.day).toBeDefined();
    expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.prev_hash).toBe('GENESIS');
  });

  it('chains successive events: each prev_hash matches the previous hash', async () => {
    const a = await service.record({ actorType: 'system', eventType: 'e1', payload: { n: 1 } });
    const b = await service.record({ actorType: 'system', eventType: 'e2', payload: { n: 2 } });
    expect(b.prev_hash).toBe(a.hash);
  });

  it('records inside a caller-owned transaction', async () => {
    const row = await db.withTransaction(async (c) => {
      return service.record(c, {
        actorType: 'user',
        actorId: 'u1',
        eventType: 'in.tx',
        payload: { x: 1 }
      });
    });
    expect(row.actor_id).toBe('u1');
  });
});

describe('audit — verifyDay', () => {
  it('returns ok=true after recording 100 events', async () => {
    for (let i = 0; i < 100; i++) {
      await service.record({ actorType: 'system', eventType: 'load', payload: { i } });
    }
    const result = await service.verifyDay(today);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(100);
  });

  it('returns ok=false with brokenAtSeq when payload is tampered', async () => {
    await service.record({ actorType: 'system', eventType: 'a', payload: { v: 1 } });
    const second = await service.record({ actorType: 'system', eventType: 'b', payload: { v: 2 } });
    await service.record({ actorType: 'system', eventType: 'c', payload: { v: 3 } });

    await query(
      `UPDATE audit_events SET payload = '{"v":99}'::jsonb WHERE id = $1`,
      [second.id]
    );

    const result = await service.verifyDay(today);
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(Number(second.seq));
  });

  it('returns ok=false when prev_hash is tampered', async () => {
    await service.record({ actorType: 'system', eventType: 'a', payload: {} });
    const b = await service.record({ actorType: 'system', eventType: 'b', payload: {} });
    await query(
      `UPDATE audit_events SET prev_hash = $2 WHERE id = $1`,
      [b.id, '0'.repeat(64)]
    );
    const result = await service.verifyDay(today);
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(Number(b.seq));
  });

  it('verifyDay handles a day with zero events', async () => {
    const result = await service.verifyDay('1999-01-01');
    expect(result).toEqual({ ok: true, count: 0 });
  });

  it('canonical payload hashing is order-independent', async () => {
    const row = await service.record({
      actorType: 'system',
      eventType: 'order.test',
      payload: { b: 2, a: 1, nested: { y: 1, x: 2 } }
    });
    // simulate JSONB returning keys in a different order
    await query(
      `UPDATE audit_events SET payload = $2::jsonb WHERE id = $1`,
      [row.id, JSON.stringify({ a: 1, nested: { x: 2, y: 1 }, b: 2 })]
    );
    const result = await service.verifyDay(today);
    expect(result.ok).toBe(true);
  });
});

describe('audit — list', () => {
  it('filters by event_type and resource_type', async () => {
    await service.record({ actorType: 'system', eventType: 'a', resourceType: 'user', resourceId: 'u1', payload: {} });
    await service.record({ actorType: 'system', eventType: 'b', resourceType: 'user', resourceId: 'u2', payload: {} });
    await service.record({ actorType: 'system', eventType: 'a', resourceType: 'session', resourceId: 's1', payload: {} });

    const r = await service.list({
      eventType: 'a',
      resourceType: 'user',
      limit: 100,
      offset: 0
    });
    expect(r.total).toBe(1);
    expect(r.rows[0].resource_id).toBe('u1');
  });

  it('paginates with limit and offset', async () => {
    for (let i = 0; i < 5; i++) {
      await service.record({ actorType: 'system', eventType: 'page', payload: { i } });
    }
    const page = await service.list({ eventType: 'page', limit: 2, offset: 2 });
    expect(page.total).toBe(5);
    expect(page.rows).toHaveLength(2);
  });
});
