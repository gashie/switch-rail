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
  RAIL_DISPUTE_RESERVE:      'RAIL_DISPUTE_RESERVE',
  // Phase 8 — escrow overlay (B8.7).
  RAIL_ESCROW:               'RAIL_ESCROW',
  // Phase 9 — cross-border native (B9.4). RAIL_FX_NOSTRO is per currency,
  // RAIL_FOREIGN_RAIL_NOSTRO is per (foreign rail × currency).
  RAIL_FX_NOSTRO:            'RAIL_FX_NOSTRO',
  RAIL_FOREIGN_RAIL_NOSTRO:  'RAIL_FOREIGN_RAIL_NOSTRO'
});

export const JOURNAL_REASONS = Object.freeze({
  TRANSACTION_CONFIRMED:    'TRANSACTION_CONFIRMED',
  REVERSAL:                 'REVERSAL',
  FEE_SETTLE:               'FEE_SETTLE',
  INTRADAY_CYCLE:           'INTRADAY_CYCLE',
  EOD_CYCLE:                'EOD_CYCLE',
  RTGS_GROSS:               'RTGS_GROSS',
  EXCEPTION:                'EXCEPTION',
  TOPUP:                    'TOPUP',
  // Phase 7 — disputes & adjudication.
  DISPUTE_RESERVE_HOLD:     'DISPUTE_RESERVE_HOLD',
  DISPUTE_RESERVE_RELEASE:  'DISPUTE_RESERVE_RELEASE',
  // Phase 8 — escrow overlay (B8.7).
  ESCROW_HOLD:              'ESCROW_HOLD',
  ESCROW_RELEASE:           'ESCROW_RELEASE',
  // Phase 9 — cross-border native (B9.4).
  XB_LEG_1:                 'XB_LEG_1',
  XB_LEG_2:                 'XB_LEG_2',
  XB_COMPENSATE:            'XB_COMPENSATE'
});

export const SIDES = Object.freeze({ DR: 'DR', CR: 'CR' });

const PARTICIPANT_OWNED = new Set([ACCOUNT_TYPES.PARTICIPANT_SETTLEMENT]);
// Foreign-rail-owned accounts: per foreign-rail-code, per currency. The
// owner identifier is the foreign rail's rail_code (e.g. 'PAPSS_FAKE').
const FOREIGN_RAIL_OWNED = new Set([ACCOUNT_TYPES.RAIL_FOREIGN_RAIL_NOSTRO]);

export const ownerTypeFor = (accountType) => {
  if (PARTICIPANT_OWNED.has(accountType)) return 'PARTICIPANT';
  if (FOREIGN_RAIL_OWNED.has(accountType)) return 'FOREIGN_RAIL';
  return 'RAIL';
};

export const accountCodeFor = ({ accountType, ownerId, currency }) => {
  if (!accountType) throw new Error('accountType required');
  if (!currency) throw new Error('currency required');
  if (PARTICIPANT_OWNED.has(accountType)) {
    if (!ownerId) throw new Error(`accountType ${accountType} requires ownerId`);
    return `PSET:${ownerId}:${currency}`;
  }
  if (FOREIGN_RAIL_OWNED.has(accountType)) {
    if (!ownerId) throw new Error(`accountType ${accountType} requires ownerId (foreign rail code)`);
    return `XBRAIL:${ownerId}:${currency}`;
  }
  return `${accountType}:${currency}`;
};
