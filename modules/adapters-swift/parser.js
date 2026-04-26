// Minimal SWIFT MT block + tag parser. Sufficient for MT103 and MT202.
// Recognizes blocks {1:...} {2:...} {3:...} {4:...} {5:...} and tag lines
// inside block 4 of the form :NN[A-Z]?:<value>.

const findMatchingBrace = (text, start) => {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
};

export const parseSwiftBlocks = (text) => {
  const blocks = {};
  let pos = 0;
  const len = text.length;
  while (pos < len) {
    if (text[pos] !== '{') {
      pos++;
      continue;
    }
    const close = findMatchingBrace(text, pos);
    if (close < 0) break;
    const inner = text.slice(pos + 1, close);
    const colon = inner.indexOf(':');
    if (colon > 0) {
      blocks[inner.slice(0, colon)] = inner.slice(colon + 1);
    }
    pos = close + 1;
  }
  return blocks;
};

export const parseBlock4Fields = (block4) => {
  if (!block4) return {};
  const body = block4
    .replace(/^[\r\n]+/, '')
    .replace(/[\r\n]?-\s*$/, '');
  const lines = body.split(/\r?\n/);
  const fields = {};
  let currentTag = null;
  let currentLines = [];
  for (const line of lines) {
    const tagMatch = line.match(/^:(\d{2}[A-Z]?):(.*)$/);
    if (tagMatch) {
      if (currentTag !== null) fields[currentTag] = currentLines.join('\n');
      currentTag = tagMatch[1];
      currentLines = [tagMatch[2]];
    } else if (currentTag !== null) {
      currentLines.push(line);
    }
  }
  if (currentTag !== null) fields[currentTag] = currentLines.join('\n');
  return fields;
};

export const buildSwiftMessage = ({ block1, block2, block4Fields }) => {
  const body = Object.entries(block4Fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([tag, value]) => `:${tag}:${value}`)
    .join('\n');
  return `{1:${block1}}{2:${block2}}{4:\n${body}\n-}`;
};

const CURRENCY_DECIMALS = {
  GHS: 2, USD: 2, EUR: 2, GBP: 2, NGN: 2, KES: 2, ZAR: 2, EGP: 2, MAD: 2,
  XOF: 0, XAF: 0, JPY: 0, KRW: 0,
  TND: 3, BHD: 3, KWD: 3, OMR: 3, JOD: 3
};

export const swiftAmountToMinor = (amountStr, currency) => {
  const m = CURRENCY_DECIMALS[currency];
  if (m === undefined) throw new Error(`unknown currency: ${currency}`);
  const cleaned = String(amountStr).trim().replace(',', '.').replace(/\.$/, '');
  if (m === 0) {
    if (!/^\d+$/.test(cleaned)) throw new Error(`amount ${cleaned} not integer for ${currency}`);
    return cleaned;
  }
  const re = new RegExp(`^(\\d+)(?:\\.(\\d{1,${m}}))?$`);
  const match = cleaned.match(re);
  if (!match) throw new Error(`amount ${cleaned} exceeds ${currency} precision`);
  const major = match[1];
  const frac = (match[2] || '').padEnd(m, '0');
  return BigInt(major + frac).toString();
};

export const minorToSwiftAmount = (minorStr, currency) => {
  const m = CURRENCY_DECIMALS[currency];
  if (m === undefined) throw new Error(`unknown currency: ${currency}`);
  if (m === 0) return `${String(minorStr)},`;
  const padded = String(minorStr).padStart(m + 1, '0');
  return `${padded.slice(0, -m)},${padded.slice(-m)}`;
};

// Parse SWIFT date YYMMDD assuming 21st century context.
export const swiftDateToIso = (yymmdd) => {
  const m = String(yymmdd).match(/^(\d{2})(\d{2})(\d{2})$/);
  if (!m) throw new Error(`invalid SWIFT date: ${yymmdd}`);
  const yy = parseInt(m[1], 10);
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  return `${year}-${m[2]}-${m[3]}`;
};

export const isoDateToSwift = (iso) => {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`invalid ISO date: ${iso}`);
  return m[1].slice(2) + m[2] + m[3];
};
