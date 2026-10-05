import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { query, withClient, closePool } from '../core/db.js';
import { createBaseCrud } from '../core/baseCrud.js';

const TABLE_SOFT = 'crud_soft_test';
const TABLE_HARD = 'crud_hard_test';

const softCrud = createBaseCrud({
  table: TABLE_SOFT,
  pk: 'id',
  columns: ['id', 'code', 'name', 'status', 'deleted_at', 'created_at', 'updated_at'],
  insertable: ['code', 'name', 'status'],
  updatable: ['name', 'status'],
  softDelete: true,
  defaultOrderBy: 'created_at ASC'
});

const hardCrud = createBaseCrud({
  table: TABLE_HARD,
  pk: 'id',
  columns: ['id', 'code', 'name', 'created_at', 'updated_at'],
  insertable: ['code', 'name'],
  updatable: ['name'],
  defaultOrderBy: 'created_at ASC'
});

beforeAll(async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS ${TABLE_SOFT} (
      id          UUID PRIMARY KEY,
      code        TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'active',
      deleted_at  TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS ${TABLE_HARD} (
      id          UUID PRIMARY KEY,
      code        TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
});

afterAll(async () => {
  await query(`DROP TABLE IF EXISTS ${TABLE_SOFT}`);
  await query(`DROP TABLE IF EXISTS ${TABLE_HARD}`);
  await closePool();
});

beforeEach(async () => {
  await query(`TRUNCATE ${TABLE_SOFT}`);
  await query(`TRUNCATE ${TABLE_HARD}`);
});

describe('baseCrud — create', () => {
  it('auto-generates a uuid id when not supplied', async () => {
    const row = await withClient((c) => softCrud.create(c, { code: 'a', name: 'A' }));
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.code).toBe('a');
  });

  it('respects an explicit id when supplied', async () => {
    const id = '01900000-0000-7000-8000-000000000001';
    const row = await withClient((c) => softCrud.create(c, { id, code: 'a', name: 'A' }));
    expect(row.id).toBe(id);
  });

  it('ignores fields not in insertable', async () => {
    const row = await withClient((c) =>
      softCrud.create(c, { code: 'a', name: 'A', updated_at: '1999-01-01' })
    );
    expect(new Date(row.updated_at).getFullYear()).toBeGreaterThan(2024);
  });
});

describe('baseCrud — read', () => {
  it('getById returns row or null', async () => {
    const row = await withClient((c) => softCrud.create(c, { code: 'a', name: 'A' }));
    expect((await withClient((c) => softCrud.getById(c, row.id))).code).toBe('a');
    expect(await withClient((c) => softCrud.getById(c, '00000000-0000-7000-8000-000000000000'))).toBeNull();
  });

  it('findOne by where clause', async () => {
    await withClient((c) => softCrud.create(c, { code: 'a', name: 'A' }));
    const row = await withClient((c) => softCrud.findOne(c, { where: { code: 'a' } }));
    expect(row.code).toBe('a');
  });

  it('findOne whitelists where keys', async () => {
    await withClient((c) => softCrud.create(c, { code: 'a', name: 'A' }));
    const row = await withClient((c) => softCrud.findOne(c, { where: { evil: 'x', code: 'a' } }));
    expect(row.code).toBe('a');
  });

  it('findMany paginates and returns total', async () => {
    await withClient(async (c) => {
      for (let i = 0; i < 7; i++) await softCrud.create(c, { code: `c${i}`, name: `N${i}` });
    });
    const page1 = await withClient((c) => softCrud.findMany(c, { limit: 3, offset: 0 }));
    const page2 = await withClient((c) => softCrud.findMany(c, { limit: 3, offset: 3 }));
    expect(page1.total).toBe(7);
    expect(page1.rows).toHaveLength(3);
    expect(page2.rows).toHaveLength(3);
    expect(page1.rows[0].code).not.toBe(page2.rows[0].code);
  });

  it('findMany rejects unknown orderBy column', async () => {
    await expect(
      withClient((c) => softCrud.findMany(c, { orderBy: 'evil_col DESC' }))
    ).rejects.toThrow(/unknown column in orderBy/);
  });

  it('findMany supports a custom orderBy', async () => {
    await withClient(async (c) => {
      await softCrud.create(c, { code: 'b', name: 'B' });
      await softCrud.create(c, { code: 'a', name: 'A' });
    });
    const r = await withClient((c) => softCrud.findMany(c, { orderBy: 'code ASC' }));
    expect(r.rows.map((x) => x.code)).toEqual(['a', 'b']);
  });
});

describe('baseCrud — update', () => {
  it('updates only updatable fields and bumps updated_at', async () => {
    const row = await withClient((c) => softCrud.create(c, { code: 'a', name: 'A' }));
    await new Promise((r) => setTimeout(r, 5));
    const updated = await withClient((c) => softCrud.update(c, row.id, { name: 'A2', code: 'NOPE' }));
    expect(updated.name).toBe('A2');
    expect(updated.code).toBe('a');
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThan(new Date(row.updated_at).getTime());
  });

  it('returns current row when nothing to update', async () => {
    const row = await withClient((c) => softCrud.create(c, { code: 'a', name: 'A' }));
    const result = await withClient((c) => softCrud.update(c, row.id, { code: 'NOPE' }));
    expect(result.id).toBe(row.id);
    expect(result.name).toBe('A');
  });
});

describe('baseCrud — soft delete', () => {
  it('remove sets deleted_at and hides from getById/findOne/findMany', async () => {
    const row = await withClient((c) => softCrud.create(c, { code: 'a', name: 'A' }));
    await withClient((c) => softCrud.remove(c, row.id));
    expect(await withClient((c) => softCrud.getById(c, row.id))).toBeNull();
    expect(await withClient((c) => softCrud.findOne(c, { where: { code: 'a' } }))).toBeNull();
    const r = await withClient((c) => softCrud.findMany(c));
    expect(r.total).toBe(0);
    const raw = await query(`SELECT deleted_at FROM ${TABLE_SOFT} WHERE id = $1`, [row.id]);
    expect(raw.rows[0].deleted_at).not.toBeNull();
  });
});

describe('baseCrud — hard delete', () => {
  it('remove deletes the row from the table when softDelete is false', async () => {
    const row = await withClient((c) => hardCrud.create(c, { code: 'a', name: 'A' }));
    await withClient((c) => hardCrud.remove(c, row.id));
    const raw = await query(`SELECT count(*)::int AS n FROM ${TABLE_HARD} WHERE id = $1`, [row.id]);
    expect(raw.rows[0].n).toBe(0);
  });
});

describe('baseCrud — upsert', () => {
  it('inserts when no conflict', async () => {
    const row = await withClient((c) => softCrud.upsert(c, ['code'], { code: 'a', name: 'A' }));
    expect(row.code).toBe('a');
    expect(row.name).toBe('A');
  });

  it('updates the existing row on conflict', async () => {
    await withClient((c) => softCrud.upsert(c, ['code'], { code: 'a', name: 'A' }));
    const row = await withClient((c) => softCrud.upsert(c, ['code'], { code: 'a', name: 'A2' }));
    expect(row.name).toBe('A2');
    const r = await withClient((c) => softCrud.findMany(c));
    expect(r.total).toBe(1);
  });
});
