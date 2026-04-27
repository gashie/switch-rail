// Locked Phase 7 dispute case state machine. Diagram in PHASES/PHASE-7.md.

export const STATES = Object.freeze({
  FILED:            'FILED',
  ACCEPTED:         'ACCEPTED',
  EVIDENCE_PENDING: 'EVIDENCE_PENDING',
  ADJUDICATING:     'ADJUDICATING',
  AUTO_RESOLVED:    'AUTO_RESOLVED',
  UPHELD:           'UPHELD',
  PARTIAL_UPHELD:   'PARTIAL_UPHELD',
  DENIED:           'DENIED',
  REJECTED:         'REJECTED',
  SETTLED:          'SETTLED'
});

// REJECTED is filing-time terminal (no reserve was ever held).
// SETTLED is post-money-movement terminal.
// DENIED is post-decision but pre-release — the reserve still needs to
// flow back to the beneficiary via confirm-settlement, so DENIED is NOT
// terminal even though the spec diagram calls it terminal. The truly-no-
// further-transitions set is {REJECTED, SETTLED}.
export const TERMINAL_STATES = Object.freeze(new Set([
  STATES.REJECTED,
  STATES.SETTLED
]));

const TRANSITIONS = Object.freeze({
  [STATES.FILED]:            new Set([STATES.ACCEPTED, STATES.REJECTED, STATES.DENIED]),
  [STATES.ACCEPTED]:         new Set([STATES.EVIDENCE_PENDING, STATES.AUTO_RESOLVED, STATES.DENIED]),
  [STATES.EVIDENCE_PENDING]: new Set([STATES.ADJUDICATING, STATES.DENIED]),
  [STATES.ADJUDICATING]:     new Set([STATES.UPHELD, STATES.DENIED, STATES.PARTIAL_UPHELD]),
  [STATES.AUTO_RESOLVED]:    new Set([STATES.SETTLED]),
  [STATES.UPHELD]:           new Set([STATES.SETTLED]),
  [STATES.PARTIAL_UPHELD]:   new Set([STATES.SETTLED]),
  [STATES.DENIED]:           new Set([STATES.SETTLED])
});

export const isTerminal = (state) => TERMINAL_STATES.has(state);

export const canTransition = (fromState, toState) => {
  if (!fromState) return false;
  const allowed = TRANSITIONS[fromState];
  return !!(allowed && allowed.has(toState));
};
