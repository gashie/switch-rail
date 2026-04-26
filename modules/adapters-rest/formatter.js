import { AppError } from '../../core/errors.js';
import { canonicalJsonBytes } from '../../core/json.js';

const stripSignature = (env) => {
  const out = { ...env };
  delete out.signature;
  return out;
};

export const signEnvelope = async (env, { cryptoKeys }) => {
  if (env.signature) return env;
  const active = await cryptoKeys.listActive({ ownerType: 'rail', ownerId: null });
  if (active.length === 0) {
    throw new AppError('CONFLICT', 'no active rail signing key', 503);
  }
  const kid = active[0].kid;
  const payload = canonicalJsonBytes(stripSignature(env));
  const result = await cryptoKeys.sign({ kid, payload });
  return { ...env, signature: { kid: result.kid, alg: result.alg, sigB64: result.signature } };
};

export const verifyEnvelope = async (env, { cryptoKeys }) => {
  if (!env || !env.signature) return false;
  const payload = canonicalJsonBytes(stripSignature(env));
  return cryptoKeys.verify({
    kid: env.signature.kid,
    payload,
    signature: env.signature.sigB64
  });
};

export const formatRest = (env, deps) => signEnvelope(env, deps);
