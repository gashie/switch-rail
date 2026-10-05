import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTransaction, query, closePool } from '../core/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const loadApplied = async () => {
  try {
    const r = await query('SELECT filename, checksum FROM schema_migrations');
    return new Map(r.rows.map((row) => [row.filename, row.checksum]));
  } catch (e) {
    if (e.code === '42P01') return new Map();
    throw e;
  }
};

const listMigrations = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

const main = async () => {
  const files = listMigrations();
  if (files.length === 0) {
    console.log('no migrations to apply');
    return;
  }

  const applied = await loadApplied();

  for (const filename of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8');
    const checksum = sha256(sql);

    if (applied.has(filename)) {
      const prev = applied.get(filename);
      if (prev !== checksum) {
        throw new Error(
          `checksum mismatch for ${filename}: stored=${prev} computed=${checksum}. migrations are immutable.`
        );
      }
      console.log(`skipped ${filename} (already applied)`);
      continue;
    }

    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations(filename, checksum) VALUES ($1, $2)',
        [filename, checksum]
      );
    });

    applied.set(filename, checksum);
    console.log(`applied ${filename}`);
  }
};

main()
  .then(() => closePool())
  .catch((err) => {
    console.error(err.message || err);
    closePool().finally(() => process.exit(1));
  });
