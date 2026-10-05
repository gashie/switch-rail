import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  generateEd25519Keypair,
  signEd25519,
  verifyEd25519,
  encryptGcm,
  decryptGcm,
  sha256,
  chainHash,
  canonicalStringify,
  hashPassword,
  verifyPassword
} from '../core/crypto.js';

const keyB64 = randomBytes(32).toString('base64');

describe('core/crypto — Ed25519', () => {
  it('signs and verifies a message', () => {
    const { publicKeyPem, privateKeyPem } = generateEd25519Keypair();
    const msg = Buffer.from('hello rail');
    const sig = signEd25519(privateKeyPem, msg);
    expect(verifyEd25519(publicKeyPem, msg, sig)).toBe(true);
  });

  it('rejects a tampered message', () => {
    const { publicKeyPem, privateKeyPem } = generateEd25519Keypair();
    const sig = signEd25519(privateKeyPem, Buffer.from('original'));
    expect(verifyEd25519(publicKeyPem, Buffer.from('tampered'), sig)).toBe(false);
  });

  it('rejects a signature from a different key', () => {
    const a = generateEd25519Keypair();
    const b = generateEd25519Keypair();
    const sig = signEd25519(a.privateKeyPem, Buffer.from('m'));
    expect(verifyEd25519(b.publicKeyPem, Buffer.from('m'), sig)).toBe(false);
  });

  it('returns false on a malformed signature instead of throwing', () => {
    const { publicKeyPem } = generateEd25519Keypair();
    expect(verifyEd25519(publicKeyPem, Buffer.from('m'), 'not-base64-***')).toBe(false);
  });
});

describe('core/crypto — AES-256-GCM', () => {
  it('encrypts and decrypts a roundtrip', () => {
    const ct = encryptGcm('top secret payload', keyB64);
    expect(decryptGcm(ct, keyB64)).toBe('top secret payload');
  });

  it('uses a fresh IV per call', () => {
    const a = encryptGcm('x', keyB64);
    const b = encryptGcm('x', keyB64);
    expect(a.ivB64).not.toBe(b.ivB64);
    expect(a.ciphertextB64).not.toBe(b.ciphertextB64);
  });

  it('rejects a tampered ciphertext', () => {
    const ct = encryptGcm('hello', keyB64);
    const tampered = {
      ...ct,
      ciphertextB64: Buffer.from(ct.ciphertextB64, 'base64').map((b, i) => (i === 0 ? b ^ 0xff : b)).toString('base64')
    };
    expect(() => decryptGcm(tampered, keyB64)).toThrow();
  });

  it('rejects a tampered tag', () => {
    const ct = encryptGcm('hello', keyB64);
    const tagBuf = Buffer.from(ct.tagB64, 'base64');
    tagBuf[0] ^= 0xff;
    expect(() => decryptGcm({ ...ct, tagB64: tagBuf.toString('base64') }, keyB64)).toThrow();
  });

  it('rejects a wrong key', () => {
    const ct = encryptGcm('hello', keyB64);
    const otherKey = randomBytes(32).toString('base64');
    expect(() => decryptGcm(ct, otherKey)).toThrow();
  });

  it('rejects a key of incorrect length', () => {
    const shortKey = randomBytes(16).toString('base64');
    expect(() => encryptGcm('x', shortKey)).toThrow(/32 bytes/);
  });
});

describe('core/crypto — sha256 / canonical / chainHash', () => {
  it('sha256 is deterministic', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
    expect(sha256('abc')).not.toBe(sha256('abcd'));
  });

  it('sha256 produces 64 hex chars', () => {
    expect(sha256('x')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('canonicalStringify is order-independent for objects', () => {
    const a = canonicalStringify({ b: 1, a: 2, c: { y: 1, x: 2 } });
    const b = canonicalStringify({ a: 2, c: { x: 2, y: 1 }, b: 1 });
    expect(a).toBe(b);
  });

  it('chainHash is deterministic for equivalent payloads', () => {
    const h1 = chainHash('prev', { b: 1, a: 2 });
    const h2 = chainHash('prev', { a: 2, b: 1 });
    expect(h1).toBe(h2);
  });

  it('chainHash differs on different prev', () => {
    expect(chainHash('p1', { x: 1 })).not.toBe(chainHash('p2', { x: 1 }));
  });

  it('chainHash differs on different payload', () => {
    expect(chainHash('p', { x: 1 })).not.toBe(chainHash('p', { x: 2 }));
  });
});

describe('core/crypto — argon2 password', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('s3cret!');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 's3cret!')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('s3cret!');
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });

  it('returns false instead of throwing on a malformed hash', async () => {
    expect(await verifyPassword('not-a-real-argon2-hash', 'anything')).toBe(false);
  });
});
