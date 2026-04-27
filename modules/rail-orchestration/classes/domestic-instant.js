/**
 * DOMESTIC_INSTANT — the canonical fully-implemented rail class.
 *
 * Matches when both originator and beneficiary participants share the same
 * country (typically GH) and at least one is a BANK or WALLET. Drives the
 * Phase 4 happy path. Aggressive retry policy: 5 attempts within ~62s.
 */
export const railClass = Object.freeze({
  name: 'DOMESTIC_INSTANT',
  priority: 1,
  timeoutMs: 10_000,
  retryPolicyName: 'aggressive',
  classify: ({ originator, beneficiary }) => {
    if (!originator || !beneficiary) return false;
    if (originator.country_code !== beneficiary.country_code) return false;
    const eligibleTypes = new Set(['BANK', 'WALLET', 'FINTECH', 'PSP']);
    return eligibleTypes.has(originator.type) || eligibleTypes.has(beneficiary.type);
  },
  prepare: async (_client, _transaction) => ({
    notes: 'domestic-instant prepare — no rail-specific setup beyond standard credit-leg'
  })
});
