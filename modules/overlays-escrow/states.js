export const STATES = Object.freeze({
  INITIATED: 'INITIATED',
  HELD:      'HELD',
  RELEASED:  'RELEASED',
  REFUNDED:  'REFUNDED',
  CANCELLED: 'CANCELLED'
});

export const TERMINAL_STATES = Object.freeze(new Set([
  STATES.RELEASED, STATES.REFUNDED, STATES.CANCELLED
]));

const TRANSITIONS = Object.freeze({
  [STATES.INITIATED]: new Set([STATES.HELD, STATES.CANCELLED]),
  [STATES.HELD]:      new Set([STATES.RELEASED, STATES.REFUNDED, STATES.CANCELLED])
});

export const isTerminal = (s) => TERMINAL_STATES.has(s);
export const canTransition = (from, to) => !!(TRANSITIONS[from] && TRANSITIONS[from].has(to));
