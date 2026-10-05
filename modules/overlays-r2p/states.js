export const STATES = Object.freeze({
  PENDING:    'PENDING',
  AUTHORIZED: 'AUTHORIZED',
  PAID:       'PAID',
  REJECTED:   'REJECTED',
  EXPIRED:    'EXPIRED'
});

export const TERMINAL_STATES = Object.freeze(new Set([
  STATES.PAID,
  STATES.REJECTED,
  STATES.EXPIRED
]));

const TRANSITIONS = Object.freeze({
  [STATES.PENDING]:    new Set([STATES.AUTHORIZED, STATES.REJECTED, STATES.EXPIRED]),
  [STATES.AUTHORIZED]: new Set([STATES.PAID, STATES.EXPIRED, STATES.REJECTED])
});

export const isTerminal = (state) => TERMINAL_STATES.has(state);
export const canTransition = (from, to) => !!(TRANSITIONS[from] && TRANSITIONS[from].has(to));
