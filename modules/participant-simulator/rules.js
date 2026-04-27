import { config } from '../../core/config.js';

// Force-account behaviour table — LOCKED per PHASES/PHASE-4.md.
// Account numbers in the range 9999000001–9999000099 are reserved for
// deterministic simulator behaviour. Everything outside the range succeeds.

export const BEHAVIORS = Object.freeze({
  SUCCESS: 'SUCCESS',
  REJECT_AM04: 'REJECT_AM04',
  REJECT_AC04: 'REJECT_AC04',
  REJECT_AC06: 'REJECT_AC06',
  REJECT_AG01: 'REJECT_AG01',
  REJECT_RR04: 'REJECT_RR04',
  TIMEOUT: 'TIMEOUT',
  SLOW_RESPONSE: 'SLOW_RESPONSE',
  INTERMITTENT: 'INTERMITTENT',
  UNREACHABLE: 'UNREACHABLE'
});

// In production, slow=7s and timeout=>10s. Tests override these via
// `config.txTestMode = true` so the suite runs in single-digit seconds.
export const delaysMs = () => {
  if (config.txTestMode) {
    return { fast: 10, slow: 700, timeoutHard: 1500 };
  }
  return { fast: 50, slow: 7_000, timeoutHard: 12_000 };
};

const FORCE_TABLE = Object.freeze({
  '9999000001': { behavior: 'SUCCESS' },
  '9999000002': { behavior: 'REJECT_AM04', reasonCode: 'INSUFFICIENT_FUNDS' },
  '9999000003': { behavior: 'REJECT_AC04', reasonCode: 'BENEFICIARY_ACCOUNT_CLOSED' },
  '9999000004': { behavior: 'REJECT_AC06', reasonCode: 'BENEFICIARY_ACCOUNT_BLOCKED' },
  '9999000005': { behavior: 'REJECT_AG01', reasonCode: 'TRANSACTION_FORBIDDEN' },
  '9999000006': { behavior: 'REJECT_RR04', reasonCode: 'REGULATORY' },
  '9999000007': { behavior: 'TIMEOUT' },
  '9999000008': { behavior: 'SLOW_RESPONSE' },
  '9999000009': { behavior: 'INTERMITTENT' },
  '9999000010': { behavior: 'UNREACHABLE' }
});

// Hardcoded force rules take precedence over per-participant overrides
// from the `simulator_overrides` table — overrides are an operator escape
// hatch, the force table is the canonical contract.
export const forceBehaviorFor = (accountNumber) => FORCE_TABLE[String(accountNumber)] || null;

export const responseForBehavior = (behavior, { reasonCode } = {}, { transactionId } = {}) => {
  switch (behavior) {
    case 'SUCCESS':
      return {
        kind: 'http_success',
        body: {
          ok: true,
          data: {
            responseCode: 'ACSC',
            creditedAt: new Date().toISOString(),
            beneficiaryRef: `SIM-${(transactionId || '').slice(0, 12)}`
          }
        }
      };
    case 'REJECT_AM04':
      return {
        kind: 'http_success',
        body: { ok: false, error: { code: 'AM04', message: 'Insufficient Funds' } }
      };
    case 'REJECT_AC04':
      return {
        kind: 'http_success',
        body: { ok: false, error: { code: 'AC04', message: 'Closed Account Number' } }
      };
    case 'REJECT_AC06':
      return {
        kind: 'http_success',
        body: { ok: false, error: { code: 'AC06', message: 'Blocked Account' } }
      };
    case 'REJECT_AG01':
      return {
        kind: 'http_success',
        body: { ok: false, error: { code: 'AG01', message: 'Transaction Forbidden' } }
      };
    case 'REJECT_RR04':
      return {
        kind: 'http_success',
        body: { ok: false, error: { code: 'RR04', message: 'Regulatory Reason' } }
      };
    case 'TIMEOUT':
      return { kind: 'never_respond' };
    case 'SLOW_RESPONSE':
      return {
        kind: 'http_success_after',
        delayMs: delaysMs().slow,
        body: {
          ok: true,
          data: {
            responseCode: 'ACSC',
            creditedAt: new Date().toISOString(),
            beneficiaryRef: `SIM-SLOW-${(transactionId || '').slice(0, 8)}`
          }
        }
      };
    case 'INTERMITTENT':
      return { kind: 'intermittent' };
    case 'UNREACHABLE':
      return { kind: 'tcp_error' };
    default:
      // Unknown behavior — treat as a graceful success so the simulator
      // never silently locks up on an operator-injected override typo.
      return responseForBehavior('SUCCESS', { reasonCode }, { transactionId });
  }
};
