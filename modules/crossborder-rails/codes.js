// Locked Phase 9 cross-border constants per PHASES/PHASE-9.md.

export const RAIL_TYPES = Object.freeze(['MULTILATERAL_HUB', 'BILATERAL']);

export const SETTLEMENT_MODELS = Object.freeze([
  'NET_DAILY',
  'GROSS_INSTANT',
  'CBDC',
  'STABLECOIN'
]);

// Foreign-rail simulator force-account taxonomy. Same shape pattern as
// Phase 4's participant simulator.
export const FORCE_ACCOUNT_BEHAVIORS = Object.freeze({
  '9999100001': { behavior: 'SUCCESS' },
  '9999100002': { behavior: 'REJECT_AC04', reasonCode: 'AC04', message: 'closed beneficiary account' },
  '9999100007': { behavior: 'TIMEOUT' },
  '9999100009': { behavior: 'ASYNC_SUCCESS', delayMs: 5000 }
});

// Test currency-pair quotes the simulator returns when asked.
export const TEST_RATES = Object.freeze({
  'GHS:NGN': '15.42',
  'GHS:KES': '12.85',
  'GHS:USD': '0.083',
  'NGN:GHS': '0.06485',
  'KES:GHS': '0.0778',
  'USD:GHS': '12.05'
});
