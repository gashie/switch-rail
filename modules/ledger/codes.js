// Locked ledger codes per PHASES/PHASE-5.md. Account types and journal
// reasons are constants the rail will live with for years; the orchestrator,
// settlement engine, and statements all key off these strings.

export const ACCOUNT_TYPES = Object.freeze({
  PARTICIPANT_SETTLEMENT:    'PARTICIPANT_SETTLEMENT',
  RAIL_FEE_REVENUE:          'RAIL_FEE_REVENUE',
  RAIL_FEE_RECEIVABLE:       'RAIL_FEE_RECEIVABLE',
  RAIL_SUSPENSE:             'RAIL_SUSPENSE',
  RAIL_REVERSAL:             'RAIL_REVERSAL',
  OPERATOR_RTGS_NOSTRO:      'OPERATOR_RTGS_NOSTRO',
  RAIL_DISPUTE_RESERVE:      'RAIL_DISPUTE_RESERVE'
});

export const JOURNAL_REASONS = Object.freeze({
  TRANSACTION_CONFIRMED: 'TRANSACTION_CONFIRMED',
  REVERSAL:              'REVERSAL',
  FEE_SETTLE:            'FEE_SETTLE',
  INTRADAY_CYCLE:        'INTRADAY_CYCLE',
  EOD_CYCLE:             'EOD_CYCLE',
  RTGS_GROSS:            'RTGS_GROSS',
  EXCEPTION:             'EXCEPTION',
  TOPUP:                 'TOPUP'
});

export const SIDES = Object.freeze({ DR: 'DR', CR: 'CR' });

const PARTICIPANT_OWNED = new Set([ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT]);

export const ownerTypeFor = (accountType) =>
  PARTICIPANT_OWNED.has(accountType) ? 'PARTICIPANT' : 'RAIL';

export const accountCodeFor = ({ accountType, ownerId, currency }) => {
  if (!accountType) throw new Error('accountType required');
  if (!currency) throw new Error('currency required');
  if (PARTICIPANT_OWNED.has(accountType)) {
    if (!ownerId) throw new Error(`accountType ${accountType} requires ownerId`);
    return `PSET:${ownerId}:${currency}`;
  }
  return `${accountType}:${currency}`;
};
