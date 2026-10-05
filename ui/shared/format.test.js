import { describe, expect, it } from 'vitest';
import { formatMinor, formatDate, truncateHash, formatPercent, formatBps } from './format.js';

describe('formatMinor', () => {
  it('formats GHS 2-decimal currency', () => {
    expect(formatMinor(15042n, 'GHS')).toBe('GHS 150.42');
    expect(formatMinor(15042n, 'GHS', { symbol: false })).toBe('150.42');
  });

  it('formats large NGN with thousands separators', () => {
    expect(formatMinor(15000000n, 'NGN')).toBe('NGN 150,000.00');
  });

  it('formats USD', () => {
    expect(formatMinor(123456n, 'USD')).toBe('USD 1,234.56');
  });

  it('formats zero-decimal currency (JPY)', () => {
    expect(formatMinor(15000n, 'JPY')).toBe('JPY 15,000');
  });

  it('formats KWD (3 decimals)', () => {
    expect(formatMinor(123456n, 'KWD')).toBe('KWD 123.456');
  });

  it('handles negative amounts', () => {
    expect(formatMinor(-15042n, 'GHS')).toBe('GHS -150.42');
  });

  it('accepts string + number inputs', () => {
    expect(formatMinor('15042', 'GHS')).toBe('GHS 150.42');
    expect(formatMinor(15042, 'GHS')).toBe('GHS 150.42');
  });

  it('falls back to 2-decimal for unknown currency', () => {
    expect(formatMinor(15042n, 'ZZZ')).toBe('ZZZ 150.42');
  });

  it('groups thousands with comma', () => {
    expect(formatMinor(123456789n, 'GHS')).toBe('GHS 1,234,567.89');
  });

  it('skips grouping when group=false', () => {
    expect(formatMinor(123456789n, 'GHS', { group: false })).toBe('GHS 1234567.89');
  });
});

describe('formatDate', () => {
  const sample = new Date('2026-04-26T14:23:45.000Z');

  it('PP -> Apr 26, 2026', () => {
    // Local timezone affects the display; we just assert the components.
    const out = formatDate(sample, 'PP');
    expect(out).toMatch(/Apr (25|26|27), 2026/);
  });

  it('yyyy-MM-dd format', () => {
    const out = formatDate(sample, 'yyyy-MM-dd');
    expect(out).toMatch(/^2026-04-(25|26|27)$/);
  });

  it('returns empty for null', () => {
    expect(formatDate(null)).toBe('');
  });

  it('returns empty for invalid date', () => {
    expect(formatDate('not-a-date')).toBe('');
  });
});

describe('truncateHash', () => {
  it('truncates a long hash', () => {
    expect(truncateHash('019dcf96-9f7f-7f3c-a6f5-b0b412476f56')).toBe('019d...6f56');
  });

  it('returns short hashes unchanged', () => {
    expect(truncateHash('abcd')).toBe('abcd');
  });

  it('handles null/undefined', () => {
    expect(truncateHash(null)).toBe('');
    expect(truncateHash(undefined)).toBe('');
  });
});

describe('formatPercent', () => {
  it('formats with 1 decimal default', () => {
    expect(formatPercent(98.345)).toBe('98.3%');
  });

  it('honors decimals param', () => {
    expect(formatPercent(98.34, 2)).toBe('98.34%');
  });
});

describe('formatBps', () => {
  it('rounds to nearest int', () => {
    expect(formatBps(50.4)).toBe('50 bps');
    expect(formatBps(50.6)).toBe('51 bps');
  });
});
