import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as db from '../../../core/db.js';
import { closePool, query } from '../../../core/db.js';
import { createCryptoKeysModel } from '../model.js';
import { createCryptoKeysService } from '../service.js';

const model = createCryptoKeysModel();
const service = createCryptoKeysService({ db, model });

beforeAll(async () => {
  await query(`DELETE FROM signing_keys`);
});

afterAll(async () => {
  await query(`DELETE FROM signing_keys`);
  await closePool();
});

beforeEach(async () => {
  await query(`DELETE FROM signing_keys`);
});

describe('crypto-keys — generate', () => {
  it('generates a keypair for the rail (ownerId = null)', async () => {
    const out = await service.generateForOwner({ ownerType: 'rail', ownerId: null });
    expect(out.kid).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.publicKeyPem).toMatch(/-----BEGIN PUBLIC KEY-----/);
  });

  it('generates a keypair for a participant', async () => {
    const out = await service.generateForOwner({ ownerType: 'participant', ownerId: 'PSP-001' });
    expect(out.kid).toBeDefined();
    expect(out.publicKeyPem).toBeDefined();
  });

  it('persists the private key encrypted at rest', async () => {
    const { kid } = await service.generateForOwner({ ownerType: 'rail', ownerId: null });
    const r = await query(
      `SELECT private_key_ciphertext, private_key_iv, private_key_tag, public_key_pem FROM signing_keys WHERE kid = $1`,
      [kid]
    );
    expect(r.rows[0].private_key_ciphertext).toBeDefined();
    expect(r.rows[0].private_key_ciphertext).not.toContain('PRIVATE KEY');
    expect(r.rows[0].private_key_iv).toBeDefined();
    expect(r.rows[0].private_key_tag).toBeDefined();
  });
});

describe('crypto-keys — sign / verify', () => {
  it('signs and verifies a message', async () => {
    const { kid } = await service.generateForOwner({ ownerType: 'rail', ownerId: null });
    const { signature, alg } = await service.sign({ kid, payload: 'hello rail' });
    expect(alg).toBe('Ed25519');
    expect(await service.verify({ kid, payload: 'hello rail', signature })).toBe(true);
  });

  it('verify returns false for a tampered message', async () => {
    const { kid } = await service.generateForOwner({ ownerType: 'rail', ownerId: null });
    const { signature } = await service.sign({ kid, payload: 'original' });
    expect(await service.verify({ kid, payload: 'tampered', signature })).toBe(false);
  });

  it('verify returns false for unknown kid', async () => {
    expect(
      await service.verify({ kid: 'unknown-kid', payload: 'x', signature: 'AAAA' })
    ).toBe(false);
  });

  it('sign throws NOT_FOUND for unknown kid', async () => {
    await expect(service.sign({ kid: 'no-such-kid', payload: 'x' })).rejects.toThrow(/kid not active/);
  });
});

describe('crypto-keys — rotate', () => {
  it('rotate marks the previous active key as rotated and creates a new one', async () => {
    const first = await service.generateForOwner({ ownerType: 'rail', ownerId: null });
    const rotated = await service.rotate({ ownerType: 'rail', ownerId: null });
    expect(rotated.newKid).not.toBe(first.kid);

    const active = await service.listActive({ ownerType: 'rail', ownerId: null });
    expect(active).toHaveLength(1);
    expect(active[0].kid).toBe(rotated.newKid);

    const r = await query(`SELECT status FROM signing_keys WHERE kid = $1`, [first.kid]);
    expect(r.rows[0].status).toBe('rotated');
  });

  it('rotate works when no previous active key exists', async () => {
    const rotated = await service.rotate({ ownerType: 'rail', ownerId: null });
    expect(rotated.newKid).toBeDefined();
    const active = await service.listActive({ ownerType: 'rail', ownerId: null });
    expect(active).toHaveLength(1);
  });

  it('sign on a rotated kid fails', async () => {
    const first = await service.generateForOwner({ ownerType: 'rail', ownerId: null });
    await service.rotate({ ownerType: 'rail', ownerId: null });
    await expect(service.sign({ kid: first.kid, payload: 'x' })).rejects.toThrow(/kid not active/);
  });
});

describe('crypto-keys — revoke', () => {
  it('revoke marks the kid as revoked', async () => {
    const { kid } = await service.generateForOwner({ ownerType: 'rail', ownerId: null });
    const result = await service.revoke({ kid });
    expect(result.revoked).toBe(true);
    const active = await service.listActive({ ownerType: 'rail', ownerId: null });
    expect(active).toHaveLength(0);
  });

  it('revoke on unknown kid returns NOT_FOUND', async () => {
    await expect(service.revoke({ kid: 'no-such-kid' })).rejects.toThrow(/kid not found/);
  });
});

describe('crypto-keys — listActive', () => {
  it('lists active keys for the rail', async () => {
    await service.generateForOwner({ ownerType: 'rail', ownerId: null });
    await service.generateForOwner({ ownerType: 'participant', ownerId: 'PSP-001' });
    const railActive = await service.listActive({ ownerType: 'rail', ownerId: null });
    expect(railActive).toHaveLength(1);
    expect(railActive[0].ownerId).toBeNull();
  });

  it('lists active keys for a specific participant', async () => {
    await service.generateForOwner({ ownerType: 'participant', ownerId: 'PSP-001' });
    await service.generateForOwner({ ownerType: 'participant', ownerId: 'PSP-002' });
    const r = await service.listActive({ ownerType: 'participant', ownerId: 'PSP-001' });
    expect(r).toHaveLength(1);
    expect(r[0].ownerId).toBe('PSP-001');
  });

  it('excludes revoked and rotated keys', async () => {
    const a = await service.generateForOwner({ ownerType: 'rail', ownerId: null });
    await service.rotate({ ownerType: 'rail', ownerId: null });
    const b = await service.generateForOwner({ ownerType: 'rail', ownerId: null });
    expect(b.kid).toBeDefined(); // rotate created one, then we generate another -> 2 active

    const beforeRevoke = await service.listActive({ ownerType: 'rail', ownerId: null });
    expect(beforeRevoke).toHaveLength(2);

    await service.revoke({ kid: b.kid });
    const afterRevoke = await service.listActive({ ownerType: 'rail', ownerId: null });
    expect(afterRevoke).toHaveLength(1);
    const ids = afterRevoke.map((k) => k.kid);
    expect(ids).not.toContain(a.kid);
    expect(ids).not.toContain(b.kid);
  });
});

describe('crypto-keys — ensureRailKey (boot helper)', () => {
  it('creates a rail key when none exists', async () => {
    const r = await service.ensureRailKey();
    expect(r.created).toBe(true);
    expect(r.kid).toBeDefined();
  });

  it('returns the existing rail key when one already exists', async () => {
    const first = await service.ensureRailKey();
    const second = await service.ensureRailKey();
    expect(second.created).toBe(false);
    expect(second.kid).toBe(first.kid);
  });
});
