import {
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  createPrivateKey,
  createPublicKey
} from 'node:crypto';
import argon2 from 'argon2';

const toBuffer = (b) => (Buffer.isBuffer(b) ? b : Buffer.from(b));

export const generateEd25519Keypair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' })
  };
};

export const signEd25519 = (privateKeyPem, bytes) => {
  const key = createPrivateKey(privateKeyPem);
  const sig = cryptoSign(null, toBuffer(bytes), key);
  return sig.toString('base64');
};

export const verifyEd25519 = (publicKeyPem, bytes, signatureB64) => {
  const key = createPublicKey(publicKeyPem);
  try {
    return cryptoVerify(null, toBuffer(bytes), key, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
};

const decodeKey = (keyB64) => {
  const k = Buffer.from(keyB64, 'base64');
  if (k.length !== 32) {
    throw new Error(`encryption key must be 32 bytes (got ${k.length})`);
  }
  return k;
};

export const encryptGcm = (plaintext, keyB64) => {
  const key = decodeKey(keyB64);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertextB64: ct.toString('base64'),
    ivB64: iv.toString('base64'),
    tagB64: tag.toString('base64')
  };
};

export const decryptGcm = ({ ciphertextB64, ivB64, tagB64 }, keyB64) => {
  const key = decodeKey(keyB64);
  const iv = Buffer.from(ivB64, 'base64');
  const ct = Buffer.from(ciphertextB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
};

export const sha256 = (input) => {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : toBuffer(input);
  return createHash('sha256').update(buf).digest('hex');
};

const canonicalize = (v) => {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canonicalize);
  const out = {};
  for (const k of Object.keys(v).sort()) out[k] = canonicalize(v[k]);
  return out;
};

export const canonicalStringify = (payload) =>
  typeof payload === 'string' ? payload : JSON.stringify(canonicalize(payload));

export const chainHash = (prevHash, payload) => {
  const payloadHash = sha256(canonicalStringify(payload));
  return sha256(`${prevHash}${payloadHash}`);
};

export const hashPassword = (plain) => argon2.hash(plain, { type: argon2.argon2id });

export const verifyPassword = async (hash, plain) => {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
};
