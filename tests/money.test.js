import { describe, expect, it } from 'vitest';
import { Money, format, minorUnitsOf } from '../core/money.js';

describe('core/money — construction', () => {
  it('accepts BigInt minor units', () => {
    const m = Money.from(100n, 'GHS');
    expect(m.minor).toBe(100n);
    expect(m.currency).toBe('GHS');
  });

  it('accepts an integer string', () => {
    expect(Money.from('250', 'USD').minor).toBe(250n);
    expect(Money.from('-7', 'USD').minor).toBe(-7n);
  });

  it('accepts an integer Number', () => {
    expect(Money.from(42, 'EUR').minor).toBe(42n);
  });

  it('rejects a non-integer Number', () => {
    expect(() => Money.from(1.5, 'GHS')).toThrow(/non-integer/);
  });

  it('rejects a malformed string', () => {
    expect(() => Money.from('1.5', 'GHS')).toThrow(/invalid integer string/);
  });

  it('rejects an unknown currency', () => {
    expect(() => Money.from(1n, 'XYZ')).toThrow(/unknown currency/);
  });

  it('Money.zero returns a zero-valued instance', () => {
    expect(Money.zero('GHS').isZero()).toBe(true);
  });
});

describe('core/money — arithmetic', () => {
  it('adds two same-currency amounts', () => {
    expect(Money.from(100n, 'GHS').add(Money.from(50n, 'GHS')).minor).toBe(150n);
  });

  it('subtracts two same-currency amounts', () => {
    expect(Money.from(100n, 'GHS').sub(Money.from(30n, 'GHS')).minor).toBe(70n);
  });

  it('multiplies by a scalar', () => {
    expect(Money.from(7n, 'GHS').mul(3).minor).toBe(21n);
    expect(Money.from(7n, 'GHS').mul(3n).minor).toBe(21n);
  });

  it('floor-divides positive amounts', () => {
    expect(Money.from(100n, 'GHS').divFloor(3).minor).toBe(33n);
  });

  it('floor-divides negative amounts toward -infinity', () => {
    expect(Money.from(-100n, 'GHS').divFloor(3).minor).toBe(-34n);
  });

  it('throws on divide by zero', () => {
    expect(() => Money.from(1n, 'GHS').divFloor(0)).toThrow(/division by zero/);
  });

  it('rejects cross-currency arithmetic', () => {
    expect(() => Money.from(1n, 'GHS').add(Money.from(1n, 'USD'))).toThrow(/currency mismatch/);
    expect(() => Money.from(1n, 'GHS').sub(Money.from(1n, 'USD'))).toThrow(/currency mismatch/);
    expect(() => Money.from(1n, 'GHS').lt(Money.from(1n, 'USD'))).toThrow(/currency mismatch/);
    expect(() => Money.from(1n, 'GHS').gt(Money.from(1n, 'USD'))).toThrow(/currency mismatch/);
  });
});

describe('core/money — comparison', () => {
  it('eq matches on currency and minor', () => {
    expect(Money.from(1n, 'GHS').eq(Money.from(1n, 'GHS'))).toBe(true);
    expect(Money.from(1n, 'GHS').eq(Money.from(1n, 'USD'))).toBe(false);
    expect(Money.from(1n, 'GHS').eq(Money.from(2n, 'GHS'))).toBe(false);
  });

  it('lt and gt order amounts', () => {
    expect(Money.from(1n, 'GHS').lt(Money.from(2n, 'GHS'))).toBe(true);
    expect(Money.from(2n, 'GHS').gt(Money.from(1n, 'GHS'))).toBe(true);
  });

  it('isZero detects zero', () => {
    expect(Money.from(0n, 'GHS').isZero()).toBe(true);
    expect(Money.from(1n, 'GHS').isZero()).toBe(false);
  });

  it('negate flips sign', () => {
    expect(Money.from(5n, 'GHS').negate().minor).toBe(-5n);
    expect(Money.from(-5n, 'GHS').negate().minor).toBe(5n);
  });
});

describe('core/money — format', () => {
  it('formats with 2 minor units (GHS)', () => {
    expect(format(Money.from(100n, 'GHS'))).toBe('1.00 GHS');
    expect(format(Money.from(12345n, 'GHS'))).toBe('123.45 GHS');
  });

  it('formats values smaller than one major unit', () => {
    expect(format(Money.from(7n, 'USD'))).toBe('0.07 USD');
  });

  it('formats negatives', () => {
    expect(format(Money.from(-12345n, 'GHS'))).toBe('-123.45 GHS');
  });

  it('formats zero-decimal currencies (XOF, JPY)', () => {
    expect(format(Money.from(1500n, 'XOF'))).toBe('1500 XOF');
    expect(format(Money.from(900n, 'JPY'))).toBe('900 JPY');
  });

  it('formats three-decimal currencies (BHD)', () => {
    expect(format(Money.from(1234n, 'BHD'))).toBe('1.234 BHD');
  });
});

describe('core/money — immutability', () => {
  it('arithmetic does not mutate the original', () => {
    const a = Money.from(10n, 'GHS');
    a.add(Money.from(5n, 'GHS'));
    expect(a.minor).toBe(10n);
  });

  it('Money instances are frozen', () => {
    const a = Money.from(1n, 'GHS');
    expect(Object.isFrozen(a)).toBe(true);
  });
});

describe('core/money — currency table', () => {
  it('exposes minorUnitsOf for known currencies', () => {
    expect(minorUnitsOf('GHS')).toBe(2);
    expect(minorUnitsOf('JPY')).toBe(0);
    expect(minorUnitsOf('BHD')).toBe(3);
  });

  it('throws for unknown currency lookups', () => {
    expect(() => minorUnitsOf('ZZZ')).toThrow(/unknown currency/);
  });
});
