export const STATES = Object.freeze({
  INITIATED:  'INITIATED',
  AUTHORIZED: 'AUTHORIZED',
  COMPLETED:  'COMPLETED',
  CANCELLED:  'CANCELLED',
  EXPIRED:    'EXPIRED'
});

export const TERMINAL_STATES = Object.freeze(new Set([
  STATES.COMPLETED, STATES.CANCELLED, STATES.EXPIRED
]));

const TRANSITIONS = Object.freeze({
  [STATES.INITIATED]:  new Set([STATES.AUTHORIZED, STATES.CANCELLED, STATES.EXPIRED]),
  [STATES.AUTHORIZED]: new Set([STATES.COMPLETED, STATES.CANCELLED, STATES.EXPIRED])
});

export const isTerminal = (s) => TERMINAL_STATES.has(s);
export const canTransition = (from, to) => !!(TRANSITIONS[from] && TRANSITIONS[from].has(to));
