// ISO 4217 numeric ↔ alpha map for currencies the rail handles.
// Numeric codes in DE 49; envelope amount.currency uses alpha-3.
const NUMERIC_TO_ALPHA = Object.freeze({
  936: 'GHS',
  840: 'USD',
  978: 'EUR',
  826: 'GBP',
  392: 'JPY',
  566: 'NGN',
  404: 'KES',
  800: 'UGX',
  834: 'TZS',
  646: 'RWF',
  710: 'ZAR',
  818: 'EGP',
  504: 'MAD',
  230: 'ETB',
  952: 'XOF',
  950: 'XAF',
  156: 'CNY',
  356: 'INR',
  784: 'AED',
  410: 'KRW',
  788: 'TND',
  48: 'BHD',
  414: 'KWD',
  512: 'OMR',
  400: 'JOD'
});

const ALPHA_TO_NUMERIC = Object.freeze(
  Object.fromEntries(
    Object.entries(NUMERIC_TO_ALPHA).map(([n, a]) => [a, String(n).padStart(3, '0')])
  )
);

export const numericToAlpha = (numeric) => {
  const n = parseInt(numeric, 10);
  const alpha = NUMERIC_TO_ALPHA[n];
  if (!alpha) throw new Error(`unknown currency numeric code: ${numeric}`);
  return alpha;
};

export const alphaToNumeric = (alpha) => {
  const n = ALPHA_TO_NUMERIC[alpha];
  if (!n) throw new Error(`unknown currency alpha code: ${alpha}`);
  return n;
};
