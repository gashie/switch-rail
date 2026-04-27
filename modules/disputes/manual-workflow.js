import { OUTCOMES, MANUAL_RATIONALE_CODES } from './codes.js';
import { STATES } from './states.js';

// Maps an outcome enum to the corresponding case state. Manual decisions
// transition ADJUDICATING -> {UPHELD, DENIED, PARTIAL_UPHELD}; the
// SETTLED transition happens via the separate confirm-settlement step
// (B7.5) per the conservative-reversal rule.
export const stateForOutcome = (outcome) => {
  switch (outcome) {
    case OUTCOMES.UPHOLD:  return STATES.UPHELD;
    case OUTCOMES.REJECT:  return STATES.DENIED;
    case OUTCOMES.PARTIAL: return STATES.PARTIAL_UPHELD;
    default:
      throw new Error(`unknown outcome ${outcome}`);
  }
};

// Validates the inbound decision body against the manual rationale taxonomy
// and outcome math. Throws a structured error string the service surfaces.
export const validateManualDecision = ({ outcome, rationaleCode, outcomeAmountMinor, caseAmountMinor }) => {
  if (!Object.values(OUTCOMES).includes(outcome)) {
    return `unknown outcome ${outcome}`;
  }
  if (!MANUAL_RATIONALE_CODES.includes(rationaleCode)) {
    return `unknown rationale code ${rationaleCode}`;
  }
  if (outcome === OUTCOMES.PARTIAL) {
    if (!outcomeAmountMinor) {
      return 'PARTIAL outcome requires outcomeAmountMinor';
    }
    const partial = BigInt(outcomeAmountMinor);
    const full = BigInt(caseAmountMinor);
    if (partial <= 0n || partial >= full) {
      return `outcomeAmountMinor must be > 0 and < ${full} for PARTIAL`;
    }
  }
  return null;
};
