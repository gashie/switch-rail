// Format helpers shared across the three apps. BigInt-safe money, ISO 4217
// minor-digit awareness, hash truncation, simple date formatting that
// avoids the heavyweight date-fns import for the hot paths.

const ISO_4217_MINOR = Object.freeze({
  GHS: 2, USD: 2, EUR: 2, GBP: 2, NGN: 2, KES: 2,
  UGX: 0, RWF: 0, XOF: 0, XAF: 0, JPY: 0, KRW: 0,
  TZS: 2, ZAR: 2, EGP: 2, MAD: 2, ETB: 2, CNY: 2, INR: 2, AED: 2,
  TND: 3, BHD: 3, KWD: 3, OMR: 3, JOD: 3
});

const minorDigitsOf = (currency) => {
  const u = ISO_4217_MINOR[currency];
  if (u === undefined) return 2;
  return u;
};

const groupDigits = (s) => {
  // Insert thousands separators in the integer portion only.
  const [intPart, fracPart] = s.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fracPart ? `${grouped}.${fracPart}` : grouped;
};

/**
 * Format BigInt minor units as a human-readable money string.
 * @param {bigint|string|number} valueMinor - amount in minor units
 * @param {string} currency - ISO 4217 alpha code
 * @param {object} [opts]
 * @param {boolean} [opts.symbol=true] - include the currency code prefix
 * @param {boolean} [opts.group=true] - thousands separators
 * @returns {string}
 */
export const formatMinor = (valueMinor, currency, opts = {}) => {
  const symbol = opts.symbol !== false;
  const group = opts.group !== false;
  const digits = minorDigitsOf(currency);
  let n;
  if (typeof valueMinor === 'bigint') n = valueMinor;
  else if (typeof valueMinor === 'string') n = BigInt(valueMinor);
  else if (typeof valueMinor === 'number') n = BigInt(Math.trunc(valueMinor));
  else n = 0n;
  const negative = n < 0n;
  const abs = negative ? -n : n;
  let text;
  if (digits === 0) {
    text = abs.toString();
  } else {
    const padded = abs.toString().padStart(digits + 1, '0');
    const intPart = padded.slice(0, -digits);
    const fracPart = padded.slice(-digits);
    text = `${intPart}.${fracPart}`;
  }
  if (group) text = groupDigits(text);
  const signed = negative ? `-${text}` : text;
  return symbol ? `${currency} ${signed}` : signed;
};

export const truncateHash = (hash, headLen = 4, tailLen = 4) => {
  if (typeof hash !== 'string' || hash.length <= headLen + tailLen + 3) return hash || '';
  return `${hash.slice(0, headLen)}...${hash.slice(-tailLen)}`;
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Format a Date or ISO string. Format codes match a subset of date-fns:
 *   PP   -> 'Apr 26, 2026'
 *   pp   -> '12:34 PM'
 *   PPpp -> 'Apr 26, 2026, 12:34 PM'
 *   PPp  -> 'Apr 26, 2026 12:34'
 *   yyyy-MM-dd -> '2026-04-26'
 *   HH:mm -> '14:23'
 */
export const formatDate = (input, fmt = 'PPpp') => {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const month = MONTH_NAMES[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  const h24 = d.getHours();
  const mins = pad2(d.getMinutes());
  const ampm = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  switch (fmt) {
    case 'PP':         return `${month} ${day}, ${year}`;
    case 'pp':         return `${h12}:${mins} ${ampm}`;
    case 'PPpp':       return `${month} ${day}, ${year}, ${h12}:${mins} ${ampm}`;
    case 'PPp':        return `${month} ${day}, ${year} ${pad2(h24)}:${mins}`;
    case 'yyyy-MM-dd': return `${year}-${pad2(d.getMonth() + 1)}-${pad2(day)}`;
    case 'HH:mm':      return `${pad2(h24)}:${mins}`;
    default:           return d.toISOString();
  }
};

export const formatPercent = (n, decimals = 1) => {
  const x = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(x)) return '0%';
  return `${x.toFixed(decimals)}%`;
};

export const formatBps = (n) => {
  const x = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(x)) return '0 bps';
  return `${Math.round(x)} bps`;
};
