// Locked refund reason codes — 5 codes.

export const REASON_CODES = Object.freeze([
  'CUSTOMER_REQUEST',
  'MERCHANT_GOODWILL',
  'OVERCHARGE',
  'SERVICE_NOT_RENDERED',
  'OTHER'
]);

export const REFUND_STATES = Object.freeze({
  INITIATED:  'INITIATED',
  PROCESSING: 'PROCESSING',
  COMPLETED:  'COMPLETED',
  FAILED:     'FAILED'
});

export const OVERLAY_TYPE = 'REFUND';
