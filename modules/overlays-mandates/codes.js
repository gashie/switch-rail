// Locked per PHASES/PHASE-8.md: 4 frequencies, 4 mandate states.

export const FREQUENCIES = Object.freeze(['DAILY', 'WEEKLY', 'MONTHLY', 'AS_PRESENTED']);

export const REVOCATION_ACTORS = Object.freeze(['PAYER', 'PAYEE', 'OPERATOR']);

export const DEBIT_RESULTS = Object.freeze({
  SUCCESS:            'SUCCESS',
  CAP_BREACH:         'CAP_BREACH',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  PAUSED:             'PAUSED',
  OTHER:              'OTHER'
});

export const OVERLAY_TYPE_DEBIT = 'MANDATE_DEBIT';
