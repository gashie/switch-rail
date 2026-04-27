/**
 * Fraud scoring — Phase 4 framework only.
 *
 * Phase 6 fills this with the rules engine, behavioural baseline scoring,
 * and the ML hook. Phase 4 always returns pass with score=0 so the
 * pipeline is wired without producing false positives or negatives.
 */
export const fraud = () => ({ pass: true, score: 0, signals: [] });
