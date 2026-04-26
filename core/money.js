// ISO 4217 minor units. Ghana + neighbours + major reserve currencies + a sample
// of zero-decimal currencies. Extend as needed; unknown currencies throw.
const ISO_4217_MINOR = Object.freeze({
  GHS: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  NGN: 2,
  KES: 2,
  UGX: 0,
  TZS: 2,
  RWF: 0,
  ZAR: 2,
  EGP: 2,
  MAD: 2,
  ETB: 2,
  XOF: 0,
  XAF: 0,
  JPY: 0,
  KRW: 0,
  CNY: 2,
  INR: 2,
  AED: 2,
  TND: 3,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  JOD: 3
});

export const minorUnitsOf = (currency) => {
  const u = ISO_4217_MINOR[currency];
  if (u === undefined) throw new Error(`unknown currency: ${currency}`);
  return u;
};

const coerceMinor = (amount) => {
  if (typeof amount === 'bigint') return amount;
  if (typeof amount === 'string') {
    if (!/^-?\d+$/.test(amount)) {
      throw new Error(`invalid integer string for Money: ${amount}`);
    }
    return BigInt(amount);
  }
  if (typeof amount === 'number') {
    if (!Number.isInteger(amount)) {
      throw new Error(`Money rejects non-integer Number: ${amount}`);
    }
    return BigInt(amount);
  }
  throw new Error(`unsupported amount type for Money: ${typeof amount}`);
};

const assertSame = (a, b) => {
  if (a.currency !== b.currency) {
    throw new Error(`currency mismatch: ${a.currency} vs ${b.currency}`);
  }
};

const make = (minor, currency) => {
  const self = {
    minor,
    currency,
    add: (other) => {
      assertSame(self, other);
      return make(self.minor + other.minor, currency);
    },
    sub: (other) => {
      assertSame(self, other);
      return make(self.minor - other.minor, currency);
    },
    mul: (scalar) => {
      const s = typeof scalar === 'bigint' ? scalar : BigInt(scalar);
      return make(self.minor * s, currency);
    },
    divFloor: (scalar) => {
      const s = typeof scalar === 'bigint' ? scalar : BigInt(scalar);
      if (s === 0n) throw new Error('division by zero');
      let q = self.minor / s;
      // BigInt division truncates toward zero. Convert to floor division.
      if ((self.minor < 0n) !== (s < 0n) && q * s !== self.minor) q -= 1n;
      return make(q, currency);
    },
    eq: (other) => other.currency === currency && other.minor === self.minor,
    lt: (other) => {
      assertSame(self, other);
      return self.minor < other.minor;
    },
    gt: (other) => {
      assertSame(self, other);
      return self.minor > other.minor;
    },
    isZero: () => self.minor === 0n,
    negate: () => make(-self.minor, currency)
  };
  return Object.freeze(self);
};

export const Money = Object.freeze({
  from: (amount, currency) => {
    minorUnitsOf(currency);
    return make(coerceMinor(amount), currency);
  },
  zero: (currency) => {
    minorUnitsOf(currency);
    return make(0n, currency);
  }
});

export const format = (money) => {
  const u = minorUnitsOf(money.currency);
  if (u === 0) return `${money.minor.toString()} ${money.currency}`;
  const neg = money.minor < 0n;
  const abs = neg ? -money.minor : money.minor;
  const padded = abs.toString().padStart(u + 1, '0');
  const major = padded.slice(0, -u);
  const frac = padded.slice(-u);
  return `${neg ? '-' : ''}${major}.${frac} ${money.currency}`;
};
