// Locked Phase 9 cross-border transaction constants.

export const OVERLAY_TYPE = 'XB_CRDT_TRF';

export const FOREIGN_RAIL_OUTCOMES = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  PENDING:  'PENDING',
  TIMEOUT:  'TIMEOUT'
});

// Backoff for foreign-rail recovery: 5s, 30s, 2m, 10m, 30m. Phase 4 recovery
// uses similar shape.
export const RECOVERY_BACKOFF_SECONDS = Object.freeze([5, 30, 120, 600, 1800]);
export const RECOVERY_MAX_ATTEMPTS = 5;
