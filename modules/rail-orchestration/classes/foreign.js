import { railClass as domesticInstant } from './domestic-instant.js';

/**
 * FOREIGN — Phase 4 framework only.
 *
 * Matches when originator and beneficiary participants live in different
 * country codes. Phase 9 (cross-border) fills this in with the FX engine,
 * PvP coordinator, and travel-rule enforcement. Phase 4 delegates to
 * DOMESTIC_INSTANT semantics so the credit-leg pipeline still works for
 * cross-border simulator flows.
 */
export const railClass = Object.freeze({
  name: 'FOREIGN',
  priority: 3,
  timeoutMs: domesticInstant.timeoutMs,
  retryPolicyName: 'conservative',
  classify: ({ originator, beneficiary }) => {
    if (!originator || !beneficiary) return false;
    return originator.country_code !== beneficiary.country_code;
  },
  prepare: domesticInstant.prepare
});
