/**
 * Liquidity check — Phase 4 framework only.
 *
 * Phase 5 fills this with real per-participant settlement-position floors
 * and ceilings (throttle/block on floor breach, prefunding top-up). Phase
 * 4 always returns pass; the position-adjustment hook the ledger module
 * will register on `CONFIRMED` is the durable counterpart to this check.
 */
export const liquidity = () => ({ pass: true, position: null });
