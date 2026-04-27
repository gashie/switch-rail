// Locked Phase 8 escrow constants per PHASES/PHASE-8.md.

export const RELEASE_CONDITIONS = Object.freeze([
  'BOTH_SIGNATURES',
  'TIME_ELAPSED',
  'PAYER_RELEASE',
  'ARBITER_RELEASE'
]);

export const OVERLAY_TYPE_HOLD = 'ESCROW_HOLD';
export const OVERLAY_TYPE_RELEASE = 'ESCROW_RELEASE';
