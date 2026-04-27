// EMVCo MPM constants — locked per PHASES/PHASE-8.md.

export const QR_TYPES = Object.freeze({ STATIC: 'STATIC', DYNAMIC: 'DYNAMIC' });

export const PAYLOAD_FORMAT_INDICATOR = '01';
export const POI_STATIC = '11';
export const POI_DYNAMIC = '12';

// Merchant Account Information template ID range — Sika uses 26.
export const SIKA_MAI_TAG = '26';
export const SIKA_GUI = 'GH.SIKA.RAIL';
export const COUNTRY_CODE = 'GH';
export const CURRENCY_NUMERIC = Object.freeze({
  GHS: '936',
  USD: '840',
  EUR: '978',
  GBP: '826',
  NGN: '566',
  KES: '404'
});

export const MAX_MERCHANT_NAME = 25;
export const MAX_MERCHANT_CITY = 15;
