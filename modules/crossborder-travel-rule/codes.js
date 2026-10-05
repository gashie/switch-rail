// Locked Phase 9 travel-rule constants. Re-export from envelope/index.js
// since the canonical lists live there with the locked envelope shape.

export {
  ID_TYPES,
  PURPOSE_OF_PAYMENT,
  SETTLEMENT_ASSET_TYPES
} from '../envelope/index.js';

export const DIRECTIONS = Object.freeze(['OUTBOUND', 'INBOUND']);

// Outcome codes returned by enforce(). Used by the coordinator + audit.
export const ENFORCEMENT_OUTCOMES = Object.freeze({
  OK:                     'OK',
  TRAVEL_RULE_INCOMPLETE: 'TRAVEL_RULE_INCOMPLETE',
  TRAVEL_RULE_SANCTIONS_HIT: 'TRAVEL_RULE_SANCTIONS_HIT'
});
