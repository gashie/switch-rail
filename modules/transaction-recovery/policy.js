/**
 * Retry policies for the recovery worker. Locked per PHASE-4.md:
 *   aggressive  → DOMESTIC_INSTANT (2s base, 5 attempts, ~62s total window)
 *   standard    → MOBILE_MONEY_INTEROP (5s base, 6 attempts, ~5min window)
 *   conservative → FOREIGN/DOMESTIC_BATCH (30s base, 8 attempts, multi-hour window)
 *
 * Backoff is exponential, doubling each step, capped at the policy's `capMs`.
 * `nextDelayMs(attempts)` returns the delay AFTER `attempts` attempts have
 * already been made — i.e. attempts=0 → first wait, attempts=1 → second wait.
 *
 * In test mode (`config.txTestMode=true`) the worker scales delays down so
 * the suite finishes in single-digit seconds; the policies themselves stay
 * production-shaped here.
 */

export const POLICIES = Object.freeze({
  aggressive: Object.freeze({
    name: 'aggressive',
    initialMs: 2_000,
    factor: 2,
    capMs: 32_000,
    maxAttempts: 5
  }),
  standard: Object.freeze({
    name: 'standard',
    initialMs: 5_000,
    factor: 2,
    capMs: 60_000,
    maxAttempts: 6
  }),
  conservative: Object.freeze({
    name: 'conservative',
    initialMs: 30_000,
    factor: 2,
    capMs: 600_000,
    maxAttempts: 8
  })
});

export const DEFAULT_POLICY_NAME = 'aggressive';

export const getPolicy = (name) => POLICIES[name] || POLICIES[DEFAULT_POLICY_NAME];

export const nextDelayMs = (policy, attempts) => {
  const ms = policy.initialMs * Math.pow(policy.factor, Math.max(0, attempts));
  return Math.min(ms, policy.capMs);
};

export const isExhausted = (policy, attempts) => attempts >= policy.maxAttempts;
