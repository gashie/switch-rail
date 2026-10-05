import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { parseCsv } from '../csv.js';
import { parsePain001 } from '../pain001.js';
import { bulkService } from '../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', 'fixtures');

const fixture = (name) => readFileSync(join(fixturesDir, name));

const ensureXlsxFixture = () => {
  const csvPath = join(fixturesDir, 'payroll.10rows.csv');
  const xlsxPath = join(fixturesDir, 'payroll.10rows.xlsx');
  if (!existsSync(fixturesDir)) mkdirSync(fixturesDir, { recursive: true });
  if (!existsSync(xlsxPath)) {
    const csv = readFileSync(csvPath, 'utf8');
    const lines = csv.trim().split(/\r?\n/);
    const headers = lines[0].split(',');
    const rows = lines.slice(1).map((line) => {
      const cells = line.split(',');
      const r = {};
      headers.forEach((h, i) => {
        r[h] = cells[i] ?? '';
      });
      return r;
    });
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'payroll');
    XLSX.writeFile(wb, xlsxPath);
  }
};

beforeAll(async () => {
  ensureXlsxFixture();
  await query(`DELETE FROM bulk_batches`);
  await query(`DELETE FROM envelopes`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'envelope.%'`);
});

afterAll(async () => {
  await query(`DELETE FROM bulk_batches`);
  await query(`DELETE FROM envelopes`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'envelope.%'`);
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM bulk_batches`);
  await query(`DELETE FROM envelopes`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'envelope.%'`);
});

describe('bulk — csv parser', () => {
  it('parses 10 rows with the canonical header', () => {
    const rows = parseCsv(fixture('payroll.10rows.csv'));
    expect(rows).toHaveLength(10);
    expect(rows[0].originator_participant).toBe('PAYROLL01');
    expect(rows[0].amount_minor).toBe('150000');
  });

  it('rejects a CSV missing required headers', () => {
    const bad = Buffer.from('foo,bar\n1,2\n', 'utf8');
    expect(() => parseCsv(bad)).toThrow(/missing required headers/);
  });
});

describe('bulk — pain.001 parser', () => {
  it('extracts 5 envelopes from a 5-tx pain.001 fixture', () => {
    const envelopes = parsePain001(fixture('pain001.5tx.xml').toString('utf8'));
    expect(envelopes).toHaveLength(5);
    expect(envelopes[0].amount).toEqual({ value: '150000', currency: 'GHS' });
    expect(envelopes[0].sourceFormat).toBe('BULK_PAIN001');
  });
});

describe('bulk — service', () => {
  it('ingests a 10-row CSV into 10 envelopes', async () => {
    const result = await bulkService.ingestCsv(fixture('payroll.10rows.csv'));
    expect(result.total).toBe(10);
    expect(result.succeeded).toBe(10);
    expect(result.failed).toBe(0);

    const r = await query(`SELECT count(*)::int AS n FROM envelopes`);
    expect(r.rows[0].n).toBe(10);
    const b = await query(`SELECT * FROM bulk_batches WHERE batch_id = $1`, [result.batchId]);
    expect(b.rows[0].source_format).toBe('BULK_CSV');
    expect(b.rows[0].succeeded).toBe(10);
  });

  it('reports per-line failures without aborting the batch', async () => {
    const csv = readFileSync(join(fixturesDir, 'payroll.10rows.csv'), 'utf8');
    // corrupt row 5 with an invalid amount
    const lines = csv.split(/\r?\n/);
    lines[5] = lines[5].replace(/,190000,/, ',not-a-number,');
    const buf = Buffer.from(lines.join('\n'), 'utf8');

    const result = await bulkService.ingestCsv(buf);
    expect(result.total).toBe(10);
    expect(result.succeeded).toBe(9);
    expect(result.failed).toBe(1);
    expect(result.failures[0].line).toBe(5);
  });

  it('ingests an XLSX workbook produced from the same payroll', async () => {
    const result = await bulkService.ingestXlsx(fixture('payroll.10rows.xlsx'));
    expect(result.total).toBe(10);
    expect(result.succeeded).toBe(10);
  });

  it('ingests a pain.001 batch of 5 transactions', async () => {
    const result = await bulkService.ingestPain001(fixture('pain001.5tx.xml').toString('utf8'));
    expect(result.total).toBe(5);
    expect(result.succeeded).toBe(5);
  });

  it('getBatch returns the persisted batch summary', async () => {
    const ingested = await bulkService.ingestCsv(fixture('payroll.10rows.csv'));
    const fetched = await bulkService.getBatch(ingested.batchId);
    expect(fetched.batch_id).toBe(ingested.batchId);
    expect(fetched.total).toBe(10);
  });
});
