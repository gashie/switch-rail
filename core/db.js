import pg from 'pg';
import { config } from './config.js';

const { Pool, types } = pg;

types.setTypeParser(20, (v) => (v == null ? null : BigInt(v)));

const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });

export const query = (text, params) => pool.query(text, params);

export const withClient = async (fn) => {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
};

export const withTransaction = async (fn) =>
  withClient(async (c) => {
    await c.query('BEGIN');
    try {
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  });

export const closePool = () => pool.end();
