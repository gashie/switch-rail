import { railClass as domesticInstant } from './domestic-instant.js';

/**
 * MOBILE_MONEY_INTEROP — Phase 4 framework only.
 *
 * Matches when at least one side is a WALLET participant. Phase 8 (overlays)
 * fills in MMI-specific behaviours (MSISDN-aware routing, agent float
 * checks). Phase 4 delegates to DOMESTIC_INSTANT semantics so the credit-leg
 * pipeline still works for wallet-side payments end-to-end via the simulator.
 */
export const railClass = Object.freeze({
  name: 'MOBILE_MONEY_INTEROP',
  priority: 2,
  timeoutMs: domesticInstant.timeoutMs,
  retryPolicyName: domesticInstant.retryPolicyName,
  classify: ({ originator, beneficiary }) => {
    if (!originator || !beneficiary) return false;
    return originator.type === 'WALLET' || beneficiary.type === 'WALLET';
  },
  prepare: domesticInstant.prepare
});
