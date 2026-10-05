import { afterAll, describe, expect, it } from 'vitest';
import { query, withClient, withTransaction, closePool } from '../core/db.js';

afterAll(async () => {
  await closePool();
});

describe('core/db', () => {
  it('runs SELECT 1 via query()', async () => {
    const r = await query('SELECT 1 AS one');
    expect(r.rows[0].one).toBe(1);
  });

  it('parses int8 (BIGINT) values as native BigInt', async () => {
    const r = await query("SELECT 9223372036854775807::bigint AS big");
    expect(typeof r.rows[0].big).toBe('bigint');
    expect(r.rows[0].big).toBe(9223372036854775807n);
  });

  it('runs work inside withClient', async () => {
    const out = await withClient(async (c) => {
      const r = await c.query('SELECT 42 AS n');
      return r.rows[0].n;
    });
    expect(out).toBe(42);
  });

  it('commits on withTransaction success', async () => {
    await withTransaction(async (c) => {
      await c.query('CREATE TEMP TABLE tx_commit_test(id INT) ON COMMIT DROP');
      await c.query('INSERT INTO tx_commit_test VALUES (1)');
      const r = await c.query('SELECT count(*)::int AS n FROM tx_commit_test');
      expect(r.rows[0].n).toBe(1);
    });
  });

  it('rolls back on withTransaction error', async () => {
    await withTransaction(async (c) => {
      await c.query('CREATE TABLE IF NOT EXISTS tx_rollback_test(id INT)');
      await c.query('DELETE FROM tx_rollback_test');
    });

    await expect(
      withTransaction(async (c) => {
        await c.query('INSERT INTO tx_rollback_test VALUES (1)');
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    const r = await query('SELECT count(*)::int AS n FROM tx_rollback_test');
    expect(r.rows[0].n).toBe(0);

    await query('DROP TABLE tx_rollback_test');
  });
});
