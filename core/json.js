// Deterministic JSON serialization for signing and hash chains.
// Object keys are sorted lexicographically at every nesting level so that two
// semantically-equivalent objects always produce the same byte sequence,
// regardless of how the serializer or DB returns key order.
const canonicalize = (v) => {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canonicalize);
  const out = {};
  for (const k of Object.keys(v).sort()) out[k] = canonicalize(v[k]);
  return out;
};

export const canonicalJson = (obj) => JSON.stringify(canonicalize(obj));

export const canonicalJsonBytes = (obj) => Buffer.from(canonicalJson(obj), 'utf8');
