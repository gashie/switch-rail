// LOCKED — see PHASES/PHASE-4.md "Locked: transaction state machine".
// Do not invent new states. Do not change transition edges. Operator
// kill-switch (REJECTED from any non-terminal) is the explicit exception
// to VALID_TRANSITIONS, encoded in canTransition below.

export const STATES = Object.freeze({
  RECEIVED: 'RECEIVED',
  AUTHORIZED: 'AUTHORIZED',
  ROUTED: 'ROUTED',
  CREDIT_LEG_PENDING: 'CREDIT_LEG_PENDING',
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
  PENDING_RECONCILIATION: 'PENDING_RECONCILIATION',
  FAILED: 'FAILED',
  REVERSED: 'REVERSED'
});

export const TERMINAL_STATES = Object.freeze([
  'CONFIRMED',
  'REJECTED',
  'REVERSED',
  'FAILED'
]);

export const VALID_TRANSITIONS = Object.freeze({
  RECEIVED: ['AUTHORIZED', 'REJECTED'],
  AUTHORIZED: ['ROUTED', 'REJECTED'],
  ROUTED: ['CREDIT_LEG_PENDING', 'REJECTED'],
  CREDIT_LEG_PENDING: ['CONFIRMED', 'REJECTED', 'PENDING_RECONCILIATION'],
  PENDING_RECONCILIATION: ['CONFIRMED', 'REJECTED', 'FAILED'],
  CONFIRMED: ['REVERSED'],
  REJECTED: [],
  REVERSED: [],
  FAILED: []
});

export const isTerminal = (s) => TERMINAL_STATES.includes(s);

export const canTransition = (from, to) => {
  if (to === 'REJECTED' && !isTerminal(from)) return true; // operator kill-switch
  return (VALID_TRANSITIONS[from] || []).includes(to);
};
