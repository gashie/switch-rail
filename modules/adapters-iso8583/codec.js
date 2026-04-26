// Minimal ISO 8583 codec — ASCII MTI + ASCII-hex bitmap (the mainstream
// interchange profile). BCD/EBCDIC variants are not implemented in Phase 2;
// the codec is parameterized so a future block can swap them in.

const setBit = (bitmap, bit) => {
  const byteIndex = Math.floor((bit - 1) / 8);
  const bitInByte = 7 - ((bit - 1) % 8);
  bitmap[byteIndex] |= 1 << bitInByte;
};

const isBitSet = (bitmap, bit) => {
  const byteIndex = Math.floor((bit - 1) / 8);
  const bitInByte = 7 - ((bit - 1) % 8);
  return (bitmap[byteIndex] & (1 << bitInByte)) !== 0;
};

const encodeFieldBody = (value, fieldSpec) => {
  const v = String(value);
  if (fieldSpec.varType === 'LLVAR') {
    if (v.length > fieldSpec.maxLength) {
      throw new Error(`DE value too long for LLVAR (${v.length} > ${fieldSpec.maxLength})`);
    }
    return String(v.length).padStart(2, '0') + v;
  }
  if (fieldSpec.varType === 'LLLVAR') {
    if (v.length > fieldSpec.maxLength) {
      throw new Error(`DE value too long for LLLVAR (${v.length} > ${fieldSpec.maxLength})`);
    }
    return String(v.length).padStart(3, '0') + v;
  }
  // fixed
  if (v.length > fieldSpec.length) {
    throw new Error(`DE value too long for fixed length ${fieldSpec.length}: ${v}`);
  }
  if (fieldSpec.type === 'n') return v.padStart(fieldSpec.length, '0');
  return v.padEnd(fieldSpec.length, ' ');
};

const decodeFieldBody = (str, pos, fieldSpec) => {
  if (fieldSpec.varType === 'LLVAR') {
    const len = parseInt(str.slice(pos, pos + 2), 10);
    if (Number.isNaN(len)) throw new Error(`bad LLVAR length at ${pos}`);
    return { value: str.slice(pos + 2, pos + 2 + len), consumed: 2 + len };
  }
  if (fieldSpec.varType === 'LLLVAR') {
    const len = parseInt(str.slice(pos, pos + 3), 10);
    if (Number.isNaN(len)) throw new Error(`bad LLLVAR length at ${pos}`);
    return { value: str.slice(pos + 3, pos + 3 + len), consumed: 3 + len };
  }
  // fixed — preserve the raw encoded string (full N chars). Higher-level
  // parsers strip leading-zero padding only where the field is a pure integer
  // (e.g. DE 4 transaction amount); for dates/times the leading zero is
  // semantic and must round-trip intact.
  const raw = str.slice(pos, pos + fieldSpec.length);
  if (fieldSpec.type === 'ans' || fieldSpec.type === 'an') {
    return { value: raw.replace(/\s+$/, ''), consumed: fieldSpec.length };
  }
  return { value: raw, consumed: fieldSpec.length };
};

export const encode8583 = ({ mti, fields }, spec) => {
  if (!/^\d{4}$/.test(String(mti))) throw new Error(`invalid MTI: ${mti}`);
  const fieldNumbers = Object.keys(fields)
    .map(Number)
    .sort((a, b) => a - b);
  const hasSecondary = fieldNumbers.some((n) => n > 64);

  const primary = Buffer.alloc(8);
  const secondary = Buffer.alloc(8);
  if (hasSecondary) setBit(primary, 1);

  for (const n of fieldNumbers) {
    if (n < 2 || n > 128) throw new Error(`DE ${n} out of range`);
    if (n <= 64) setBit(primary, n);
    else setBit(secondary, n - 64);
  }

  let body = '';
  for (const n of fieldNumbers) {
    const fieldSpec = spec[n];
    if (!fieldSpec) throw new Error(`no spec for DE ${n}`);
    body += encodeFieldBody(fields[n], fieldSpec);
  }

  const primaryHex = primary.toString('hex').toUpperCase();
  const secondaryHex = hasSecondary ? secondary.toString('hex').toUpperCase() : '';
  return Buffer.from(String(mti) + primaryHex + secondaryHex + body, 'ascii');
};

export const decode8583 = (buf, spec) => {
  const ascii = Buffer.isBuffer(buf) ? buf.toString('ascii') : String(buf);
  let pos = 0;

  if (ascii.length < 4 + 16) throw new Error('message too short');
  const mti = ascii.slice(pos, pos + 4);
  if (!/^\d{4}$/.test(mti)) throw new Error(`invalid MTI: ${mti}`);
  pos += 4;

  const primaryHex = ascii.slice(pos, pos + 16);
  pos += 16;
  if (!/^[0-9A-Fa-f]{16}$/.test(primaryHex)) throw new Error('invalid primary bitmap');
  const primary = Buffer.from(primaryHex, 'hex');

  let secondary = null;
  if (isBitSet(primary, 1)) {
    const secondaryHex = ascii.slice(pos, pos + 16);
    pos += 16;
    if (!/^[0-9A-Fa-f]{16}$/.test(secondaryHex)) throw new Error('invalid secondary bitmap');
    secondary = Buffer.from(secondaryHex, 'hex');
  }

  const fields = {};
  for (let n = 2; n <= 128; n++) {
    const present =
      n <= 64 ? isBitSet(primary, n) : !!secondary && isBitSet(secondary, n - 64);
    if (!present) continue;
    const fieldSpec = spec[n];
    if (!fieldSpec) throw new Error(`no spec for DE ${n} (set in bitmap)`);
    const { value, consumed } = decodeFieldBody(ascii, pos, fieldSpec);
    fields[n] = value;
    pos += consumed;
  }
  return { mti, fields };
};
