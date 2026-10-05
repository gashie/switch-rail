// Shared string utilities used by name-enquiry, Confirmation of Payee, and
// (in later phases) the fraud module. No external dependencies.

// ---------------------------------------------------------------------------
// Normalization — the canonical form used by every name-comparison call site.
// uppercase + NFD + strip combining diacritics + collapse whitespace.
// ---------------------------------------------------------------------------
export const normalizeForCompare = (value) =>
  String(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

// Token-sorted normalization. Used for CoP — "MENSAH KOFI" ≡ "KOFI MENSAH".
export const normalizeAndSortTokens = (value) => {
  const norm = normalizeForCompare(value);
  if (!norm) return '';
  return norm.split(' ').filter(Boolean).sort().join(' ');
};

// ---------------------------------------------------------------------------
// Name masking — first + last letter visible per word, asterisks in between.
//   "KOFI MENSAH"          → "K**I M****H"
//   "AKE"                  → "A*E"
//   "JO"                   → "J*"
//   "X"                    → "X"
// ---------------------------------------------------------------------------
export const maskName = (value) => {
  const v = String(value || '').trim();
  if (!v) return '';
  return v
    .split(/\s+/)
    .map((word) => {
      if (word.length <= 1) return word;
      if (word.length === 2) return `${word[0]}*`;
      return `${word[0]}${'*'.repeat(word.length - 2)}${word[word.length - 1]}`;
    })
    .join(' ');
};

// ---------------------------------------------------------------------------
// Jaro-Winkler similarity. Pure function, no external lib.
// Range [0, 1]; 1 means identical.
// ---------------------------------------------------------------------------
const jaro = (s1, s2) => {
  if (s1 === s2) return 1;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;

  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k += 1;
    if (s1[i] !== s2[k]) transpositions += 1;
    k += 1;
  }
  transpositions = transpositions / 2;

  return (matches / len1 + matches / len2 + (matches - transpositions) / matches) / 3;
};

export const jaroWinkler = (a, b, { prefixScale = 0.1, prefixCap = 4 } = {}) => {
  const s1 = String(a || '');
  const s2 = String(b || '');
  const j = jaro(s1, s2);
  if (j === 0) return 0;
  let common = 0;
  const max = Math.min(prefixCap, s1.length, s2.length);
  for (let i = 0; i < max; i++) {
    if (s1[i] === s2[i]) common += 1;
    else break;
  }
  return j + common * prefixScale * (1 - j);
};

// ---------------------------------------------------------------------------
// Token-subset detection — does one set of tokens fully contain the other?
// Used by CoP partial-match catch-all (e.g., typed "KOFI" vs canonical
// "KOFI MENSAH ASANTE" should still partial-match).
// ---------------------------------------------------------------------------
export const tokensSubset = (a, b) => {
  const ta = new Set(normalizeForCompare(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeForCompare(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return false;
  const [smaller, bigger] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const t of smaller) if (!bigger.has(t)) return false;
  return true;
};
