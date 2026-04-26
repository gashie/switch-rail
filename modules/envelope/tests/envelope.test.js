import { describe, expect, it } from 'vitest';
import {
  createEnvelope,
  freezeEnvelope,
  validateEnvelope,
  assertEnvelope,
  MSG_TYPES,
  SOURCE_FORMATS,
  ACCOUNT_TYPES,
  FEE_BEARERS,
  SETTLEMENT_METHODS
} from '../index.js';

const baseInput = () => ({
  msgType: 'CRDT_TRF',
  sourceFormat: 'REST',
  sourceMessageId: 'msg-001',
  endToEndId: 'e2e-001',
  idempotencyKey: 'idem-key-123',
  originator: {
    participantCode: 'BANK01',
    accountId: '0123456789',
    accountType: 'BANK_ACCOUNT',
    name: 'KOFI MENSAH',
    countryCode: 'GH'
  },
  beneficiary: {
    participantCode: 'BANK02',
    accountId: '9876543210',
    accountType: 'BANK_ACCOUNT',
    name: 'AMA OWUSU',
    countryCode: 'GH'
  },
  amount: { value: '15000', currency: 'GHS' }
});

describe('envelope — schema enums', () => {
  it('exports the canonical enum lists', () => {
    expect(MSG_TYPES).toContain('CRDT_TRF');
    expect(SOURCE_FORMATS).toContain('ISO20022');
    expect(ACCOUNT_TYPES).toContain('BANK_ACCOUNT');
    expect(FEE_BEARERS).toContain('SHAR');
    expect(SETTLEMENT_METHODS).toContain('CLRG');
  });

  it('enum lists are frozen', () => {
    expect(Object.isFrozen(MSG_TYPES)).toBe(true);
    expect(Object.isFrozen(SOURCE_FORMATS)).toBe(true);
  });
});

describe('envelope — createEnvelope happy path', () => {
  it('builds a valid envelope from minimal input', () => {
    const env = createEnvelope(baseInput());
    expect(env.envelopeId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(env.msgVersion).toBe('1.0');
    expect(env.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(env.metadata).toEqual({});
  });

  it('honors envelopeId / createdAt if provided', () => {
    const env = createEnvelope({
      ...baseInput(),
      envelopeId: '01900000-0000-7000-8000-000000000001',
      createdAt: '2026-04-01T10:00:00.000Z'
    });
    expect(env.envelopeId).toBe('01900000-0000-7000-8000-000000000001');
    expect(env.createdAt).toBe('2026-04-01T10:00:00.000Z');
  });

  it('returned envelope is deeply frozen', () => {
    const env = createEnvelope(baseInput());
    expect(Object.isFrozen(env)).toBe(true);
    expect(Object.isFrozen(env.originator)).toBe(true);
    expect(Object.isFrozen(env.amount)).toBe(true);
    expect(() => {
      env.envelopeId = 'tampered';
    }).toThrow();
  });

  it('accepts an optional fee block', () => {
    const env = createEnvelope({
      ...baseInput(),
      fee: { value: '50', currency: 'GHS', bearer: 'DEBT' }
    });
    expect(env.fee).toEqual({ value: '50', currency: 'GHS', bearer: 'DEBT' });
  });

  it('accepts a settlement date and method', () => {
    const env = createEnvelope({
      ...baseInput(),
      settlementDate: '2026-04-26',
      settlementMethod: 'CLRG'
    });
    expect(env.settlementDate).toBe('2026-04-26');
    expect(env.settlementMethod).toBe('CLRG');
  });
});

describe('envelope — createEnvelope rejection cases', () => {
  it('rejects unknown top-level keys', () => {
    expect(() => createEnvelope({ ...baseInput(), evil: 'x' })).toThrow(/invalid envelope/i);
  });

  it('rejects an unknown msgType', () => {
    expect(() => createEnvelope({ ...baseInput(), msgType: 'NOT_REAL' })).toThrow(
      /invalid envelope/i
    );
  });

  it('rejects amount.value as a Number (must be digit string)', () => {
    expect(() =>
      createEnvelope({ ...baseInput(), amount: { value: 15000, currency: 'GHS' } })
    ).toThrow(/invalid envelope/i);
  });

  it('rejects amount.value containing a decimal point', () => {
    expect(() =>
      createEnvelope({ ...baseInput(), amount: { value: '150.00', currency: 'GHS' } })
    ).toThrow(/invalid envelope/i);
  });

  it('rejects missing idempotencyKey', () => {
    const input = baseInput();
    delete input.idempotencyKey;
    expect(() => createEnvelope(input)).toThrow(/invalid envelope/i);
  });

  it('rejects an idempotencyKey that is too short', () => {
    expect(() => createEnvelope({ ...baseInput(), idempotencyKey: 'short' })).toThrow(
      /invalid envelope/i
    );
  });

  it('rejects msgVersion other than 1.0', () => {
    expect(() => createEnvelope({ ...baseInput(), msgVersion: '0.9' })).toThrow(
      /invalid envelope/i
    );
  });

  it('rejects an originator missing required fields', () => {
    const input = baseInput();
    delete input.originator.accountId;
    expect(() => createEnvelope(input)).toThrow(/invalid envelope/i);
  });

  it('rejects a non-uppercase currency', () => {
    expect(() =>
      createEnvelope({ ...baseInput(), amount: { value: '1', currency: 'ghs' } })
    ).toThrow(/invalid envelope/i);
  });

  it('rejects an unknown sourceFormat', () => {
    expect(() => createEnvelope({ ...baseInput(), sourceFormat: 'UNKNOWN' })).toThrow(
      /invalid envelope/i
    );
  });
});

describe('envelope — validators', () => {
  it('validateEnvelope returns ok=true for a valid envelope', () => {
    const env = createEnvelope(baseInput());
    const r = validateEnvelope(env);
    expect(r.ok).toBe(true);
  });

  it('validateEnvelope returns ok=false with details for an invalid envelope', () => {
    const r = validateEnvelope({ msgType: 'BAD' });
    expect(r.ok).toBe(false);
    expect(Array.isArray(r.error)).toBe(true);
    expect(r.error.length).toBeGreaterThan(0);
  });

  it('assertEnvelope returns the validated value on success', () => {
    const env = createEnvelope(baseInput());
    const v = assertEnvelope(env);
    expect(v.envelopeId).toBe(env.envelopeId);
  });

  it('assertEnvelope throws AppError on failure', () => {
    expect(() => assertEnvelope({ msgType: 'BAD' })).toThrow(/invalid envelope/i);
  });
});

describe('envelope — freezeEnvelope', () => {
  it('deep-freezes a plain object tree', () => {
    const o = { a: { b: { c: 1 } }, list: [{ x: 2 }] };
    const f = freezeEnvelope(o);
    expect(Object.isFrozen(f)).toBe(true);
    expect(Object.isFrozen(f.a)).toBe(true);
    expect(Object.isFrozen(f.a.b)).toBe(true);
    expect(Object.isFrozen(f.list[0])).toBe(true);
  });
});
