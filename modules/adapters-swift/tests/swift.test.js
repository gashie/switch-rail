import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { createEnvelope } from '../../envelope/index.js';
import {
  parseMT103,
  formatMT103,
  parseMT202,
  formatMT202,
  parseMT900,
  parseMT910,
  parseSwiftBlocks,
  parseBlock4Fields,
  swiftService
} from '../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) =>
  readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8');

const baseInput = (overrides = {}) => ({
  msgType: 'CRDT_TRF',
  sourceFormat: 'SWIFT_MT',
  sourceMessageId: 'REF-TEST-001',
  endToEndId: 'REF-TEST-001',
  idempotencyKey: 'swift:mt103:REF-TEST-001',
  originator: {
    participantCode: 'BANK01GH',
    accountId: '0123456789',
    accountType: 'BANK_ACCOUNT',
    name: 'KOFI MENSAH',
    bic: 'BANK01GHACX'
  },
  beneficiary: {
    participantCode: 'BANK02GH',
    accountId: '9876543210',
    accountType: 'BANK_ACCOUNT',
    name: 'AMA OWUSU',
    bic: 'BANK02GHACX'
  },
  amount: { value: '15000', currency: 'GHS' },
  fee: { value: '0', currency: 'GHS', bearer: 'DEBT' },
  remittance: 'Payment for invoice 001',
  settlementDate: '2026-04-26',
  metadata: { bankOpCode: 'CRED', senderToReceiver: '' },
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

describe('swift — block / tag parser primitives', () => {
  it('splits a complete SWIFT message into blocks', () => {
    const text = `{1:F01BANK01GHACX0000000000}{2:I103BANK02GHACXN}{4:\n:20:REF-001\n-}`;
    const blocks = parseSwiftBlocks(text);
    expect(blocks['1']).toBe('F01BANK01GHACX0000000000');
    expect(blocks['2']).toBe('I103BANK02GHACXN');
    expect(blocks['4']).toContain(':20:REF-001');
  });

  it('parses block-4 tag lines', () => {
    const block4 = `\n:20:ABC-123\n:32A:260426GHS150,00\n:71A:OUR\n-`;
    const fields = parseBlock4Fields(block4);
    expect(fields['20']).toBe('ABC-123');
    expect(fields['32A']).toBe('260426GHS150,00');
    expect(fields['71A']).toBe('OUR');
  });

  it('joins multi-line field values', () => {
    const block4 = `\n:50K:/0123456789\nKOFI MENSAH\n:59:/9876543210\nAMA OWUSU\n-`;
    const fields = parseBlock4Fields(block4);
    expect(fields['50K']).toBe('/0123456789\nKOFI MENSAH');
    expect(fields['59']).toBe('/9876543210\nAMA OWUSU');
  });
});

describe('swift — MT103', () => {
  it('parses the committed fixture', () => {
    const env = parseMT103(fixture('mt103.sample.txt'));
    expect(env.msgType).toBe('CRDT_TRF');
    expect(env.sourceFormat).toBe('SWIFT_MT');
    expect(env.amount).toEqual({ value: '15000', currency: 'GHS' });
    expect(env.originator.name).toBe('KOFI MENSAH');
    expect(env.beneficiary.name).toBe('AMA OWUSU');
    expect(env.originator.accountId).toBe('0123456789');
    expect(env.fee.bearer).toBe('DEBT');
    expect(env.settlementDate).toBe('2026-04-26');
  });

  it('round-trips parse(format(env)) ≈ env', () => {
    const env = createEnvelope(baseInput());
    const text = formatMT103(env);
    const parsed = parseMT103(text);
    expect(stripVolatile(parsed)).toEqual(stripVolatile(env));
  });
});

describe('swift — MT202', () => {
  it('parses the committed fixture', () => {
    const env = parseMT202(fixture('mt202.sample.txt'));
    expect(env.msgType).toBe('CRDT_TRF');
    expect(env.amount).toEqual({ value: '15000', currency: 'GHS' });
    expect(env.originator.bic).toBe('BANK01GHACX');
    expect(env.beneficiary.bic).toBe('BANK02GHACX');
  });

  it('round-trips parse(format(env)) ≈ env', () => {
    const mt202Env = createEnvelope({
      msgType: 'CRDT_TRF',
      sourceFormat: 'SWIFT_MT',
      sourceMessageId: 'REF-TEST-001',
      endToEndId: 'RELREF-001',
      idempotencyKey: 'swift:mt202:REF-TEST-001',
      originator: {
        participantCode: 'BANK01GH',
        accountId: 'BANK01GHACX',
        accountType: 'BANK_ACCOUNT',
        name: 'BANK BANK01GHACX',
        bic: 'BANK01GHACX'
      },
      beneficiary: {
        participantCode: 'BANK02GH',
        accountId: 'BANK02GHACX',
        accountType: 'BANK_ACCOUNT',
        name: 'BANK BANK02GHACX',
        bic: 'BANK02GHACX'
      },
      amount: { value: '15000', currency: 'GHS' },
      settlementDate: '2026-04-26',
      metadata: { relatedReference: 'RELREF-001' }
    });
    const text = formatMT202(mt202Env);
    const parsed = parseMT202(text);
    expect(stripVolatile(parsed)).toEqual(stripVolatile(mt202Env));
  });
});

describe('swift — MT900/MT910 parse-only', () => {
  it('parses an MT900 confirmation', () => {
    const text = `{1:F01BANK01GHACX0000000000}{2:O900...N}{4:\n:20:DBT-001\n:21:REF-MT103-001\n:25:0123456789\n:32A:260426GHS150,00\n-}`;
    const env = parseMT900(text);
    expect(env.msgType).toBe('PMT_STATUS');
    expect(env.amount).toEqual({ value: '15000', currency: 'GHS' });
    expect(env.metadata.confirmationKind).toBe('MT900');
  });

  it('parses an MT910 confirmation', () => {
    const text = `{1:F01BANK02GHACX0000000000}{2:O910...N}{4:\n:20:CRD-001\n:21:REF-MT103-001\n:25:9876543210\n:32A:260426GHS150,00\n-}`;
    const env = parseMT910(text);
    expect(env.metadata.confirmationKind).toBe('MT910');
  });
});

describe('swift — service', () => {
  it('inbound persists an MT103 fixture', async () => {
    const text = fixture('mt103.sample.txt');
    const result = await swiftService.inbound(text, 'mt103');
    expect(result.deduped).toBe(false);
    const r = await query(`SELECT count(*)::int AS n FROM envelopes`);
    expect(r.rows[0].n).toBe(1);
  });

  it('outbound formats an MT103 from envelope', () => {
    const env = createEnvelope(baseInput());
    const text = swiftService.outbound({ envelope: env, kind: 'mt103' });
    expect(text).toContain(':20:REF-TEST-001');
    expect(text).toContain(':32A:260426GHS150,00');
    expect(text).toContain(':50K:/0123456789');
  });

  it('outbound rejects unsupported kind (e.g. mt900)', () => {
    const env = createEnvelope(baseInput());
    expect(() => swiftService.outbound({ envelope: env, kind: 'mt900' })).toThrow(
      /unsupported SWIFT outbound/
    );
  });
});
