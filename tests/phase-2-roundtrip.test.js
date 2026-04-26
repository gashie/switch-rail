// Phase 2 cross-adapter round-trip suite. For each wire format, build a
// canonical envelope, format it to that wire format, parse back, and assert
// the envelope shape survives the trip.
import { afterAll, describe, expect, it } from 'vitest';
import { closePool } from '../core/db.js';
import { createEnvelope } from '../modules/envelope/index.js';
import { parseRest } from '../modules/adapters-rest/index.js';
import {
  parsePacs008Xml,
  formatPacs008Xml
} from '../modules/adapters-iso20022/index.js';
import { parse8583, format8583 } from '../modules/adapters-iso8583/index.js';
import {
  parseMT103,
  formatMT103,
  parseMT202,
  formatMT202
} from '../modules/adapters-swift/index.js';
import { parseCsv, parsePain001 } from '../modules/adapters-bulk/index.js';

const baseInput = (overrides = {}) => ({
  msgType: 'CRDT_TRF',
  sourceFormat: 'REST',
  sourceMessageId: 'P2RT-MSG-001',
  endToEndId: 'P2RT-E2E-001',
  idempotencyKey: 'phase2-roundtrip-001',
  originator: {
    participantCode: 'BANK01GH',
    accountId: '0123456789',
    accountType: 'BANK_ACCOUNT',
    name: 'KOFI MENSAH',
    bic: 'BANK01GHACX',
    countryCode: 'GH'
  },
  beneficiary: {
    participantCode: 'BANK02GH',
    accountId: '9876543210',
    accountType: 'BANK_ACCOUNT',
    name: 'AMA OWUSU',
    bic: 'BANK02GHACX',
    countryCode: 'GH'
  },
  amount: { value: '15000', currency: 'GHS' },
  settlementDate: '2026-04-26',
  settlementMethod: 'CLRG',
  remittance: 'Phase 2 round-trip',
  ...overrides
});

const stripVolatile = (env) => {
  const out = { ...env };
  delete out.envelopeId;
  delete out.createdAt;
  delete out.idempotencyKey;
  return out;
};

afterAll(async () => {
  await closePool();
});

describe('phase-2 round-trip: every adapter preserves the canonical envelope', () => {
  it('REST is identity (parse(env) returns env)', () => {
    const env = createEnvelope(baseInput());
    const parsed = parseRest(env);
    expect(parsed).toEqual(env);
  });

  it('ISO 20022 pacs.008 round-trips', () => {
    // pacs.008 carries every field including settlementMethod, purposeCode,
    // and PstlAdr/Ctry, so the full base input round-trips.
    const env = createEnvelope(baseInput({ sourceFormat: 'ISO20022', purposeCode: 'GDDS' }));
    const xml = formatPacs008Xml(env);
    const parsed = parsePacs008Xml(xml);
    expect(stripVolatile(parsed)).toEqual(stripVolatile(env));
  });

  it('ISO 8583 (1987 / 1993 / 2003) round-trips', () => {
    const versions = ['1987', '1993', '2003'];
    for (const version of versions) {
      const env = createEnvelope({
        msgType: 'CRDT_TRF',
        sourceFormat: 'ISO8583',
        sourceMessageId: '123456',
        endToEndId: 'RREF12345678',
        idempotencyKey: `iso8583:${version}:roundtrip`,
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
          version,
          processingCode: '000000',
          transmissionDateTime: '0426100000',
          localTime: '100000',
          localDate: '0426',
          terminalId: 'TERM0001',
          acceptorId: 'ACCEPTORTEST123'
        }
      });
      const buf = format8583(env, version);
      const parsed = parse8583(buf, version);
      expect(stripVolatile(parsed)).toEqual(stripVolatile(env));
    }
  });

  it('SWIFT MT103 round-trips', () => {
    // MT103 does not carry settlementMethod / countryCode — keep the input
    // shape minimal so round-trip equality is exact.
    // Tag 20 is the only reference in MT103, so sourceMessageId and
    // endToEndId share that single value on round-trip.
    const env = createEnvelope({
      msgType: 'CRDT_TRF',
      sourceFormat: 'SWIFT_MT',
      sourceMessageId: 'P2RT-MT103-001',
      endToEndId: 'P2RT-MT103-001',
      idempotencyKey: 'phase2-mt103-001',
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
      remittance: 'Phase 2 round-trip',
      settlementDate: '2026-04-26',
      metadata: { bankOpCode: 'CRED', senderToReceiver: '' }
    });
    const text = formatMT103(env);
    const parsed = parseMT103(text);
    expect(stripVolatile(parsed)).toEqual(stripVolatile(env));
  });

  it('SWIFT MT202 round-trips (FI-to-FI transfer)', () => {
    const env = createEnvelope({
      msgType: 'CRDT_TRF',
      sourceFormat: 'SWIFT_MT',
      sourceMessageId: 'P2RT-202-001',
      endToEndId: 'RELREF-001',
      idempotencyKey: 'phase2-mt202-001',
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
    const text = formatMT202(env);
    const parsed = parseMT202(text);
    expect(stripVolatile(parsed)).toEqual(stripVolatile(env));
  });

  it('Bulk CSV produces 10 well-formed rows', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const csvPath = join(here, '..', 'modules', 'adapters-bulk', 'fixtures', 'payroll.10rows.csv');
    const rows = parseCsv(readFileSync(csvPath));
    expect(rows).toHaveLength(10);
    expect(rows[0].originator_participant).toBe('PAYROLL01');
  });

  it('Bulk pain.001 produces 5 envelopes', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const xmlPath = join(here, '..', 'modules', 'adapters-bulk', 'fixtures', 'pain001.5tx.xml');
    const envs = parsePain001(readFileSync(xmlPath, 'utf8'));
    expect(envs).toHaveLength(5);
    expect(envs.every((e) => e.amount.currency === 'GHS')).toBe(true);
  });
});
