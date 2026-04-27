import { railClass as domesticInstant } from './domestic-instant.js';

/**
 * DOMESTIC_BATCH — Phase 4 framework only.
 *
 * Reserved for batch-specific behaviour (settlement-cycle batching, lower
 * priority routing). Matches only when an envelope explicitly opts in via
 * `metadata.batch === true`. Phase 5 (settlement) will fill in the
 * batch-specific settlement window logic. Phase 4 delegates to
 * DOMESTIC_INSTANT.
 */
export const railClass = Object.freeze({
  name: 'DOMESTIC_BATCH',
  priority: 99,
  timeoutMs: domesticInstant.timeoutMs,
  retryPolicyName: 'standard',
  classify: ({ envelope }) => Boolean(envelope?.metadata?.batch === true),
  prepare: domesticInstant.prepare
});
