export const STATES = Object.freeze({
  ACTIVE:    'ACTIVE',
  PAUSED:    'PAUSED',
  REVOKED:   'REVOKED',
  EXHAUSTED: 'EXHAUSTED'
});

export const TERMINAL_STATES = Object.freeze(new Set([STATES.REVOKED, STATES.EXHAUSTED]));

export const isTerminal = (s) => TERMINAL_STATES.has(s);
