// Locked Phase 7 dispute reason codes + SLA windows. Per the Phase 6 patch,
// SLA windows are properties of the reason code (not the workflow), so they
// live in the same table as the codes. Operators must not invent new codes
// without a phase change.

export const REASON_CODES = Object.freeze({
  FRAUD:               'FRAUD',
  UNAUTHORIZED:        'UNAUTHORIZED',
  DUPLICATE:           'DUPLICATE',
  GOODS_NOT_RECEIVED:  'GOODS_NOT_RECEIVED',
  WRONG_AMOUNT:        'WRONG_AMOUNT',
  WRONG_BENEFICIARY:   'WRONG_BENEFICIARY',
  TECHNICAL:           'TECHNICAL',
  REGULATORY:          'REGULATORY',
  // Phase 8 — overlay-specific dispute reason codes.
  R2P_DUPLICATE:           'R2P_DUPLICATE',
  MANDATE_UNAUTHORIZED:    'MANDATE_UNAUTHORIZED',
  MANDATE_EXCESS:          'MANDATE_EXCESS',
  REFUND_DUPLICATE:        'REFUND_DUPLICATE',
  ESCROW_RELEASE_DISPUTED: 'ESCROW_RELEASE_DISPUTED',
  // Phase 9 — cross-border-specific dispute reason codes.
  XB_FOREIGN_REJECT:          'XB_FOREIGN_REJECT',
  XB_FX_DISPUTE:              'XB_FX_DISPUTE',
  XB_SETTLEMENT_ASSET_FAILED: 'XB_SETTLEMENT_ASSET_FAILED'
});

// Filing window: how long after the original CONFIRMED transaction a dispute
// can still be filed. null = no window (REGULATORY).
// Response window: how many calendar days the responder has to upload evidence.
// autoResolvable: which auto-resolver rule (if any) applies. null = always manual.
export const SLA_WINDOWS = Object.freeze({
  [REASON_CODES.FRAUD]:              { fileWithinDays: 80,  responseDays: 5, autoResolvable: 'r-fraud' },
  [REASON_CODES.UNAUTHORIZED]:       { fileWithinDays: 60,  responseDays: 5, autoResolvable: null },
  [REASON_CODES.DUPLICATE]:          { fileWithinDays: 90,  responseDays: 3, autoResolvable: 'r-duplicate' },
  [REASON_CODES.GOODS_NOT_RECEIVED]: { fileWithinDays: 120, responseDays: 7, autoResolvable: null },
  [REASON_CODES.WRONG_AMOUNT]:       { fileWithinDays: 30,  responseDays: 5, autoResolvable: null },
  [REASON_CODES.WRONG_BENEFICIARY]:  { fileWithinDays: 30,  responseDays: 5, autoResolvable: 'r-wrong-beneficiary' },
  [REASON_CODES.TECHNICAL]:          { fileWithinDays: 30,  responseDays: 3, autoResolvable: 'r-technical' },
  [REASON_CODES.REGULATORY]:         { fileWithinDays: null, responseDays: 1, autoResolvable: null },
  // Phase 8 overlay reason codes.
  [REASON_CODES.R2P_DUPLICATE]:           { fileWithinDays: 90,  responseDays: 3, autoResolvable: 'r-r2p-duplicate' },
  [REASON_CODES.MANDATE_UNAUTHORIZED]:    { fileWithinDays: 60,  responseDays: 5, autoResolvable: null },
  [REASON_CODES.MANDATE_EXCESS]:          { fileWithinDays: 60,  responseDays: 5, autoResolvable: 'r-mandate-excess' },
  [REASON_CODES.REFUND_DUPLICATE]:        { fileWithinDays: 90,  responseDays: 3, autoResolvable: 'r-refund-duplicate' },
  [REASON_CODES.ESCROW_RELEASE_DISPUTED]: { fileWithinDays: 60,  responseDays: 7, autoResolvable: null },
  // Phase 9 — cross-border. Wider response windows reflect the foreign-rail
  // round-trip; auto-resolvers are deferred to Phase 11+ (foreign-rail
  // operator dashboards aren't yet productionized).
  [REASON_CODES.XB_FOREIGN_REJECT]:          { fileWithinDays: 90,  responseDays: 10, autoResolvable: null },
  [REASON_CODES.XB_FX_DISPUTE]:              { fileWithinDays: 30,  responseDays: 7,  autoResolvable: null },
  [REASON_CODES.XB_SETTLEMENT_ASSET_FAILED]: { fileWithinDays: 60,  responseDays: 10, autoResolvable: null }
});

export const OUTCOMES = Object.freeze({
  UPHOLD:  'UPHOLD',
  REJECT:  'REJECT',
  PARTIAL: 'PARTIAL'
});

// Locked manual rationale code taxonomy. Adjudicator must pick one of these.
export const MANUAL_RATIONALE_CODES = Object.freeze([
  'EVIDENCE_INSUFFICIENT',
  'EVIDENCE_FAVORS_FILER',
  'EVIDENCE_FAVORS_RESPONDER',
  'OPERATIONAL_ERROR_CONFIRMED',
  'REGULATORY_DIRECTION',
  'CUSTOMER_BEHAVIOR_CONTRIBUTED',
  'BENEFICIARY_REFUND_VOLUNTARY'
]);

// Auto-resolver rationale codes. Each auto-resolver rule emits one of these.
export const AUTO_RATIONALE_CODES = Object.freeze([
  'AUTO_FRAUD_FASTTRACK_COMPLETED',
  'AUTO_DUPLICATE_MATCH_FOUND',
  'AUTO_TECHNICAL_RECON_BREAK',
  'AUTO_WRONG_BENEFICIARY_COP_OVERRIDE'
]);

export const FILING_RATE_LIMIT = Object.freeze({
  windowHours: 24,
  maxPerCustomer: 100
});
