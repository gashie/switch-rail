import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { createEnvelope } from '../../envelope/index.js';
import {
  parsePacs008Xml,
  formatPacs008Xml,
  parsePacs002Xml,
  formatPacs002Xml,
  parsePacs004Xml,
  formatPacs004Xml,
  parsePacs007Xml,
  formatPacs007Xml,
  parseCamt056Xml,
  formatCamt056Xml,
  iso20022Service
} from '../index.js';
import { decimalToMinor, minorToDecimal } from '../xml.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) =>
  readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8');

const baseInput = (overrides = {}) => ({
  msgType: 'CRDT_TRF',
  sourceFormat: 'ISO20022',
  sourceMessageId: 'TEST-MSG-001',
  endToEndId: 'TEST-E2E-001',
  idempotencyKey: 'iso20022:pacs008:TEST-MSG-001:TEST-E2E-001',
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
  purposeCode: 'GDDS',
  remittance: 'Payment for invoice 001',
  ...overrides
});

// Non-pacs.008 messages don't carry settlementMethod/purposeCode/remittance
// so a leaner shape is used for those round-trips. countryCode is also dropped
// because the simpler messages don't include PstlAdr blocks.
const minimalInput = (overrides = {}) => ({
  msgType: 'PMT_STATUS',
  sourceFormat: 'ISO20022',
  sourceMessageId: 'TEST-MSG-001',
  endToEndId: 'TEST-E2E-001',
  idempotencyKey: 'iso20022:simple:TEST-MSG-001:TEST-E2E-001',
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

describe('iso20022 — money helpers', () => {
  it('decimalToMinor handles 2-decimal currency', () => {
    expect(decimalToMinor('150.00', 'GHS')).toBe('15000');
    expect(decimalToMinor('0.07', 'USD')).toBe('7');
    expect(decimalToMinor('150', 'GHS')).toBe('15000');
  });

  it('decimalToMinor handles 0-decimal currency', () => {
    expect(decimalToMinor('1500', 'XOF')).toBe('1500');
    expect(decimalToMinor('900', 'JPY')).toBe('900');
  });

  it('decimalToMinor rejects excess precision', () => {
    expect(() => decimalToMinor('1.234', 'GHS')).toThrow(/exceeds GHS precision/);
    expect(() => decimalToMinor('1.5', 'JPY')).toThrow(/not integer/);
  });

  it('minorToDecimal is the inverse', () => {
    expect(minorToDecimal('15000', 'GHS')).toBe('150.00');
    expect(minorToDecimal('1500', 'XOF')).toBe('1500');
    expect(minorToDecimal('1234', 'BHD')).toBe('1.234');
  });
});

describe('iso20022 — pacs.008 round-trip', () => {
  it('parses the committed fixture', () => {
    const env = parsePacs008Xml(fixture('pacs008.sample.xml'));
    expect(env.msgType).toBe('CRDT_TRF');
    expect(env.sourceFormat).toBe('ISO20022');
    expect(env.sourceMessageId).toBe('SAMPLE-PACS008-001');
    expect(env.amount).toEqual({ value: '15000', currency: 'GHS' });
    expect(env.originator.bic).toBe('BANK01GHACX');
    expect(env.beneficiary.bic).toBe('BANK02GHACX');
    expect(env.purposeCode).toBe('GDDS');
    expect(env.remittance).toBe('Payment for invoice 001');
    expect(env.settlementMethod).toBe('CLRG');
    expect(env.settlementDate).toBe('2026-04-26');
  });

  it('round-trips parse(format(env)) ≈ env', () => {
    const env = createEnvelope(baseInput());
    const xml = formatPacs008Xml(env);
    const parsed = parsePacs008Xml(xml);
    expect(stripVolatile(parsed)).toEqual(stripVolatile(env));
  });

  it('round-trip preserves zero-decimal currency', () => {
    const env = createEnvelope(
      baseInput({ amount: { value: '1500', currency: 'XOF' } })
    );
    const xml = formatPacs008Xml(env);
    const parsed = parsePacs008Xml(xml);
    expect(parsed.amount).toEqual({ value: '1500', currency: 'XOF' });
  });
});

describe('iso20022 — pacs.002 round-trip', () => {
  it('parses the committed fixture', () => {
    const env = parsePacs002Xml(fixture('pacs002.sample.xml'));
    expect(env.msgType).toBe('PMT_STATUS');
    expect(env.metadata.txStatus).toBe('ACSC');
    expect(env.endToEndId).toBe('019dcad9-0000-7000-8000-000000000001');
    expect(env.amount).toEqual({ value: '15000', currency: 'GHS' });
  });

  it('round-trips parse(format(env)) ≈ env', () => {
    const env = createEnvelope(
      minimalInput({
        msgType: 'PMT_STATUS',
        metadata: { txStatus: 'ACSC', reasonCode: 'G000', reasonText: 'Settled' }
      })
    );
    const xml = formatPacs002Xml(env);
    const parsed = parsePacs002Xml(xml);
    expect(stripVolatile(parsed)).toEqual(stripVolatile(env));
  });
});

describe('iso20022 — pacs.004 round-trip', () => {
  it('parses the committed fixture', () => {
    const env = parsePacs004Xml(fixture('pacs004.sample.xml'));
    expect(env.msgType).toBe('PMT_RETURN');
    expect(env.metadata.returnReasonCode).toBe('AC04');
  });

  it('round-trips parse(format(env)) ≈ env', () => {
    const env = createEnvelope(
      minimalInput({
        msgType: 'PMT_RETURN',
        metadata: { returnReasonCode: 'AC04', returnReasonText: 'Account closed' }
      })
    );
    const xml = formatPacs004Xml(env);
    const parsed = parsePacs004Xml(xml);
    expect(stripVolatile(parsed)).toEqual(stripVolatile(env));
  });
});

describe('iso20022 — pacs.007 round-trip', () => {
  it('parses the committed fixture', () => {
    const env = parsePacs007Xml(fixture('pacs007.sample.xml'));
    expect(env.msgType).toBe('PMT_REVERSAL');
    expect(env.metadata.reversalReasonCode).toBe('FRAD');
  });

  it('round-trips parse(format(env)) ≈ env', () => {
    const env = createEnvelope(
      minimalInput({
        msgType: 'PMT_REVERSAL',
        metadata: { reversalReasonCode: 'FRAD', reversalReasonText: 'Fraud' }
      })
    );
    const xml = formatPacs007Xml(env);
    const parsed = parsePacs007Xml(xml);
    expect(stripVolatile(parsed)).toEqual(stripVolatile(env));
  });
});

describe('iso20022 — camt.056 round-trip', () => {
  it('parses the committed fixture', () => {
    const env = parseCamt056Xml(fixture('camt056.sample.xml'));
    expect(env.msgType).toBe('PMT_REVERSAL');
    expect(env.metadata.cancellationReasonCode).toBe('DUPL');
  });

  it('round-trips parse(format(env)) ≈ env', () => {
    const env = createEnvelope(
      minimalInput({
        msgType: 'PMT_REVERSAL',
        metadata: { cancellationReasonCode: 'DUPL', cancellationReasonText: 'Duplicate' }
      })
    );
    const xml = formatCamt056Xml(env);
    const parsed = parseCamt056Xml(xml);
    expect(stripVolatile(parsed)).toEqual(stripVolatile(env));
  });
});

describe('iso20022 — service / parse rejection', () => {
  it('rejects malformed XML on parse', () => {
    expect(() => parsePacs008Xml('<not-pacs008/>')).toThrow(/not a pacs.008/);
  });

  it('inboundPacs008 ingests the fixture into the envelopes table', async () => {
    const result = await iso20022Service.inboundPacs008(fixture('pacs008.sample.xml'));
    expect(result.deduped).toBe(false);
    expect(result.envelope.amount).toEqual({ value: '15000', currency: 'GHS' });

    const r = await query(`SELECT count(*)::int AS n FROM envelopes`);
    expect(r.rows[0].n).toBe(1);
  });

  it('outbound formats an envelope back to XML for a known type', () => {
    const env = createEnvelope(baseInput());
    const xml = iso20022Service.outbound({ type: 'pacs008', envelope: env });
    expect(xml).toContain('<Document');
    expect(xml).toContain('<FIToFICstmrCdtTrf>');
    expect(xml).toContain('<IntrBkSttlmAmt Ccy="GHS">150.00</IntrBkSttlmAmt>');
  });

  it('outbound rejects an unknown type', () => {
    const env = createEnvelope(baseInput());
    expect(() => iso20022Service.outbound({ type: 'pacs999', envelope: env })).toThrow(
      /unknown iso20022 type/
    );
  });
});
