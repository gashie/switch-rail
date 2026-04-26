import { config } from '../../core/config.js';
import { AppError } from '../../core/errors.js';
import {
  generateEd25519Keypair,
  signEd25519,
  verifyEd25519,
  encryptGcm,
  decryptGcm
} from '../../core/crypto.js';
import { uuidv7 } from '../../core/uuid.js';

const toBytes = (payload) =>
  Buffer.isBuffer(payload) ? payload : Buffer.from(typeof payload === 'string' ? payload : String(payload), 'utf8');

const insertNewKey = async (client, model, { ownerType, ownerId }) => {
  const { publicKeyPem, privateKeyPem } = generateEd25519Keypair();
  const enc = encryptGcm(privateKeyPem, config.encryptionKey);
  const id = uuidv7();
  const kid = uuidv7();
  await model.insertKey(client, {
    id,
    ownerType,
    ownerId: ownerId ?? null,
    kid,
    publicKeyPem,
    ciphertextB64: enc.ciphertextB64,
    ivB64: enc.ivB64,
    tagB64: enc.tagB64
  });
  return { kid, publicKeyPem };
};

export const createCryptoKeysService = ({ db, model }) => ({
  generateForOwner: ({ ownerType, ownerId }) =>
    db.withTransaction((c) => insertNewKey(c, model, { ownerType, ownerId })),

  sign: ({ kid, payload }) =>
    db.withClient(async (c) => {
      const row = await model.getActiveByKid(c, kid);
      if (!row) throw new AppError('NOT_FOUND', 'kid not active', 404);
      const privateKeyPem = decryptGcm(
        {
          ciphertextB64: row.private_key_ciphertext,
          ivB64: row.private_key_iv,
          tagB64: row.private_key_tag
        },
        config.encryptionKey
      );
      const signature = signEd25519(privateKeyPem, toBytes(payload));
      return { signature, alg: 'Ed25519', kid };
    }),

  verify: ({ kid, payload, signature }) =>
    db.withClient(async (c) => {
      const row = await model.getByKid(c, kid);
      if (!row) return false;
      return verifyEd25519(row.public_key_pem, toBytes(payload), signature);
    }),

  rotate: ({ ownerType, ownerId }) =>
    db.withTransaction(async (c) => {
      await model.markActiveAsRotated(c, { ownerType, ownerId });
      const { kid, publicKeyPem } = await insertNewKey(c, model, { ownerType, ownerId });
      return { newKid: kid, publicKeyPem };
    }),

  revoke: ({ kid }) =>
    db.withTransaction(async (c) => {
      const row = await model.revokeByKid(c, kid);
      if (!row) throw new AppError('NOT_FOUND', 'kid not found', 404);
      return { revoked: true, kid };
    }),

  listActive: ({ ownerType, ownerId }) =>
    db.withClient(async (c) => {
      const rows = await model.listActive(c, { ownerType, ownerId });
      return rows.map((r) => ({
        kid: r.kid,
        publicKeyPem: r.public_key_pem,
        status: r.status,
        ownerType: r.owner_type,
        ownerId: r.owner_id,
        activatedAt: r.activated_at
      }));
    }),

  ensureRailKey: () =>
    db.withTransaction(async (c) => {
      const existing = await model.listActive(c, { ownerType: 'rail', ownerId: null });
      if (existing.length > 0) {
        return { kid: existing[0].kid, publicKeyPem: existing[0].public_key_pem, created: false };
      }
      const out = await insertNewKey(c, model, { ownerType: 'rail', ownerId: null });
      return { ...out, created: true };
    })
});
