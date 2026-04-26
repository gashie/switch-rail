import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../core/uuid.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('core/uuid', () => {
  it('produces a valid UUID string shape', () => {
    const id = uuidv7();
    expect(id).toMatch(UUID_RE);
  });

  it('encodes version 7 in the version nibble', () => {
    for (let i = 0; i < 100; i++) {
      const id = uuidv7();
      expect(id[14]).toBe('7');
    }
  });

  it('encodes the RFC 4122 variant (10xx) in the variant nibble', () => {
    for (let i = 0; i < 100; i++) {
      const id = uuidv7();
      const v = parseInt(id[19], 16);
      expect(v >= 0x8 && v <= 0xb).toBe(true);
    }
  });

  it('produces unique values across rapid succession', () => {
    const seen = new Set();
    for (let i = 0; i < 5000; i++) seen.add(uuidv7());
    expect(seen.size).toBe(5000);
  });

  it('is time-ordered: later calls compare > earlier calls', async () => {
    const a = uuidv7();
    await new Promise((r) => setTimeout(r, 5));
    const b = uuidv7();
    await new Promise((r) => setTimeout(r, 5));
    const c = uuidv7();
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
  });

  it('encodes the current ms timestamp in the leading 48 bits', () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();
    const tsHex = id.slice(0, 8) + id.slice(9, 13);
    const ts = Number(BigInt('0x' + tsHex));
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
