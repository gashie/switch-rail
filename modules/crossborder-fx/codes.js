export const QUOTE_STATES = Object.freeze({
  OPEN:              'OPEN',
  LOCKED:            'LOCKED',
  CONSUMED:          'CONSUMED',
  EXPIRED:           'EXPIRED',
  REJECTED_SLIPPAGE: 'REJECTED_SLIPPAGE'
});

export const TERMINAL_QUOTE_STATES = Object.freeze(new Set([
  QUOTE_STATES.CONSUMED,
  QUOTE_STATES.EXPIRED,
  QUOTE_STATES.REJECTED_SLIPPAGE
]));
