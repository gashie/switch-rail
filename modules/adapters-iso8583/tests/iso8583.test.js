import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { createEnvelope } from '../../envelope/index.js';
import { encode8583, decode8583 } from '../codec.js';
import { SPEC_1987 } from '../specs/1987.js';
import { parse8583, format8583, iso8583Service } from '../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', 'fixtures');

const baseInput = (overrides = {}) => ({
  msgType: 'CRDT_TRF',
  sourceFormat: 'ISO8583',
  sourceMessageId: '123456',
  endToEndId: 'RREF12345678',
  idempotencyKey: 'iso8583:1987:123456:0426100000:12345678',
  originator: {
    participantCode: '12345678',
    accountId: '0123456789',
    accountType: 'BANK_ACCOUNT',
    name: 'KOFI MENSAH'
  },
  beneficiary: {
    participantCode: '87654321',
    accountId: '9876543210',
    accountType: 'BANK_ACCOUNT',
    name: 'BENEFICIARY'
  },
  amount: { value: '15000', currency: 'GHS' },
  metadata: {
    mti: '0200',
    processingCode: '000000',
    transmissionDateTime: '0426100000',
    localTime: '100000',
    localDate: '0426',
    terminalId: 'TERM0001',
    acceptorId: 'ACCEPTORTEST123',
    version: '1987'
  },
  ...overrides
});

const stripVolatile = (env) => {
  const out = { ...env };
  delete out.envelopeId;
  delete out.createdAt;
  delete out.idempotencyKey;
  return out;
};

beforeAll(async () => {
  if (!existsSync(fixturesDir)) mkdirSync(fixturesDir, { recursive: true });
  // Generate the committed fixture file from a known envelope so that the
  // demo curl path can read it deterministically.
  const fixturePath = join(fixturesDir, '0200.1987.bin');
  if (!existsSync(fixturePath)) {
    const env = createEnvelope(baseInput());
    const buf = format8583(env, '1987');
    writeFileSync(fixturePath, buf);
  }
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

describe('iso8583 — codec primitives', () => {
  it('encodes and decodes a simple message round-trip', () => {
    const original = {
      mti: '0200',
      fields: { 3: '000000', 4: '000000015000', 11: '123456', 49: '936' }
    };
    const buf = encode8583(original, SPEC_1987);
    const decoded = decode8583(buf, SPEC_1987);
    expect(decoded.mti).toBe('0200');
    // codec preserves raw N-char numeric fields (parsers strip semantically).
    expect(decoded.fields[3]).toBe('000000');
    expect(decoded.fields[4]).toBe('000000015000');
    expect(decoded.fields[11]).toBe('123456');
    expect(decoded.fields[49]).toBe('936');
  });

  it('encodes LLVAR with a 2-digit length prefix', () => {
    const buf = encode8583(
      { mti: '0200', fields: { 32: '12345678' } },
      SPEC_1987
    );
    const ascii = buf.toString('ascii');
    // After 0200 + 16-hex bitmap, expect "08" then "12345678"
    expect(ascii).toContain('0812345678');
  });

  it('rejects an invalid MTI', () => {
    expect(() => encode8583({ mti: 'BAD', fields: {} }, SPEC_1987)).toThrow(/invalid MTI/);
  });

  it('rejects truncated input on decode', () => {
    expect(() => decode8583(Buffer.from('0200', 'ascii'), SPEC_1987)).toThrow();
  });

  it('handles a secondary bitmap when DE > 64 is set', () => {
    const original = {
      mti: '0200',
      fields: { 4: '000000015000', 11: '123456', 49: '936', 100: '12345', 102: '0001' }
    };
    const buf = encode8583(original, SPEC_1987);
    const decoded = decode8583(buf, SPEC_1987);
    expect(decoded.fields[100]).toBe('12345');
    expect(decoded.fields[102]).toBe('0001');
  });
});

describe('iso8583 — round-trip per version', () => {
  it.each(['1987', '1993', '2003'])('round-trips %s parse(format(env)) ≈ env', (version) => {
    const env = createEnvelope({ ...baseInput(), metadata: { ...baseInput().metadata, version } });
    const buf = format8583(env, version);
    const parsed = parse8583(buf, version);
    expect(stripVolatile(parsed)).toEqual(stripVolatile(env));
  });

  it('parses the committed 0200.1987.bin fixture', () => {
    const buf = readFileSync(join(fixturesDir, '0200.1987.bin'));
    const env = parse8583(buf, '1987');
    expect(env.msgType).toBe('CRDT_TRF');
    expect(env.sourceFormat).toBe('ISO8583');
    expect(env.amount).toEqual({ value: '15000', currency: 'GHS' });
    expect(env.originator.participantCode).toBe('12345678');
  });
});

describe('iso8583 — parser rejects bad input', () => {
  it('rejects unsupported MTI', () => {
    const buf = Buffer.from(
      '0900' + // MTI not in supported list
        '0000000000000000', // empty bitmap
      'ascii'
    );
    expect(() => parse8583(buf, '1987')).toThrow(/unsupported MTI/);
  });

  it('rejects unknown version', () => {
    expect(() => parse8583(Buffer.from('0200'), '1900')).toThrow(/unknown ISO 8583 version/);
  });
});

describe('iso8583 — service ingest', () => {
  it('inbound persists the parsed envelope', async () => {
    const env = createEnvelope(baseInput());
    const buf = format8583(env, '1987');
    const result = await iso8583Service.inbound(buf, '1987');
    expect(result.deduped).toBe(false);
    const r = await query(`SELECT count(*)::int AS n FROM envelopes`);
    expect(r.rows[0].n).toBe(1);
  });

  it('outbound encodes an envelope to a binary message', () => {
    const env = createEnvelope(baseInput());
    const buf = iso8583Service.outbound({ envelope: env, version: '1987' });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString('ascii').slice(0, 4)).toBe('0200');
  });
});
