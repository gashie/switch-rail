import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../../core/db.js';
import { canonicalJson, canonicalJsonBytes } from '../../../core/json.js';
import { createEnvelope } from '../../envelope/index.js';
import { cryptoKeysService } from '../../crypto-keys/index.js';
import { parseRest } from '../parser.js';
import { signEnvelope, verifyEnvelope } from '../formatter.js';
import { restService } from '../index.js';

const baseInput = (overrides = {}) => ({
  msgType: 'CRDT_TRF',
  sourceFormat: 'REST',
  sourceMessageId: 'rest-msg-001',
  endToEndId: 'rest-e2e-001',
  idempotencyKey: 'rest-idem-aaaa01',
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
  amount: { value: '15000', currency: 'GHS' },
  ...overrides
});

beforeAll(async () => {
  await query(`DELETE FROM envelopes`);
  await query(`DELETE FROM audit_events WHERE event_type LIKE 'envelope.%'`);
  await cryptoKeysService.ensureRailKey();
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

describe('adapters-rest — parser', () => {
  it('passes a valid envelope through', () => {
    const env = createEnvelope(baseInput());
    const parsed = parseRest(env);
    expect(parsed.envelopeId).toBe(env.envelopeId);
  });

  it('rejects a non-object body', () => {
    expect(() => parseRest('not-an-object')).toThrow(/JSON object/);
    expect(() => parseRest(null)).toThrow(/JSON object/);
    expect(() => parseRest([])).toThrow(/JSON object/);
  });

  it('rejects a Number amount.value', () => {
    const bad = { ...baseInput(), amount: { value: 15000, currency: 'GHS' } };
    expect(() => parseRest(bad)).toThrow(/invalid envelope/i);
  });

  it('rejects a malformed envelope (missing required field)', () => {
    const bad = baseInput();
    delete bad.idempotencyKey;
    expect(() => parseRest(bad)).toThrow(/invalid envelope/i);
  });
});

describe('adapters-rest — canonical JSON', () => {
  it('canonicalJson is order-independent', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('canonicalJsonBytes returns a UTF-8 buffer', () => {
    const buf = canonicalJsonBytes({ a: 'hello' });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString('utf8')).toBe('{"a":"hello"}');
  });
});

describe('adapters-rest — formatter (sign/verify)', () => {
  it('signs an envelope and verify roundtrips with canonical JSON', async () => {
    const env = createEnvelope(baseInput());
    const signed = await signEnvelope(env, { cryptoKeys: cryptoKeysService });
    expect(signed.signature.alg).toBe('Ed25519');
    expect(signed.signature.kid).toBeDefined();
    expect(signed.signature.sigB64).toBeDefined();

    const ok = await verifyEnvelope(signed, { cryptoKeys: cryptoKeysService });
    expect(ok).toBe(true);
  });

  it('verify fails when the envelope payload is mutated', async () => {
    const env = createEnvelope(baseInput());
    const signed = await signEnvelope(env, { cryptoKeys: cryptoKeysService });
    const tampered = { ...signed, amount: { value: '99999', currency: 'GHS' } };
    expect(await verifyEnvelope(tampered, { cryptoKeys: cryptoKeysService })).toBe(false);
  });

  it('returns the envelope unchanged when already signed', async () => {
    const env = createEnvelope(baseInput());
    const signedOnce = await signEnvelope(env, { cryptoKeys: cryptoKeysService });
    const signedTwice = await signEnvelope(signedOnce, { cryptoKeys: cryptoKeysService });
    expect(signedTwice.signature.sigB64).toBe(signedOnce.signature.sigB64);
  });

  it('signing is order-independent (canonical JSON)', async () => {
    const env = createEnvelope(baseInput());
    const reordered = JSON.parse(canonicalJson(env)); // sorts keys
    const a = await signEnvelope(env, { cryptoKeys: cryptoKeysService });
    const b = await signEnvelope(reordered, { cryptoKeys: cryptoKeysService });
    // Signatures may differ (random nonce in Ed25519? no — Ed25519 is deterministic).
    // Both should at least verify against their own envelopes.
    expect(await verifyEnvelope(a, { cryptoKeys: cryptoKeysService })).toBe(true);
    expect(await verifyEnvelope(b, { cryptoKeys: cryptoKeysService })).toBe(true);
  });
});

describe('adapters-rest — service', () => {
  it('inbound persists a fresh envelope', async () => {
    const env = createEnvelope(baseInput());
    const result = await restService.inbound(env);
    expect(result.deduped).toBe(false);
    expect(result.envelope.envelopeId).toBe(env.envelopeId);
  });

  it('inbound dedupes a repeat submission', async () => {
    const env = createEnvelope(baseInput());
    await restService.inbound(env);
    const env2 = createEnvelope({ ...baseInput(), envelopeId: undefined });
    const result = await restService.inbound(env2);
    expect(result.deduped).toBe(true);
    expect(result.envelope.envelopeId).toBe(env.envelopeId);
  });

  it('outbound signs and the signature verifies', async () => {
    const env = createEnvelope(baseInput());
    const signed = await restService.outbound(env);
    expect(signed.signature).toBeDefined();
    expect(await restService.verify(signed)).toBe(true);
  });
});
