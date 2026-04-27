// Overlay msgType tags carried in envelope.metadata.overlay.type. The
// canonical envelope.msgType remains 'CRDT_TRF' (or stays unsent for
// stored-only requests like R2P_REQUEST). PHASE-8.md locks the 10 overlay
// type tags; we own only the two R2P ones here.

export const OVERLAY_TYPES = Object.freeze({
  R2P_REQUEST:   'R2P_REQUEST',
  R2P_AUTHORIZE: 'R2P_AUTHORIZE'
});

export const REJECTION_REASONS = Object.freeze([
  'CUSTOMER_DECLINED',
  'INSUFFICIENT_FUNDS',
  'WRONG_REQUEST',
  'OTHER'
]);

export const DEFAULT_EXPIRY_HOURS = 24;
export const MIN_EXPIRY_HOURS = 1;
export const MAX_EXPIRY_DAYS = 30;
