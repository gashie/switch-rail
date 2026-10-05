/**
 * Duplicates check.
 *
 * Within the last 7 days, no other transaction may exist with the same
 * (originator_participant, end_to_end_id). The orchestrator pre-fetches
 * `ctx.recentMatchingE2E` — an array of transactions that share the same
 * (originator_participant, end_to_end_id) within the window, excluding the
 * current transaction. If non-empty, this is a duplicate and the rail
 * rejects with `DUPLICATE` (ISO 20022 `AM05`).
 */
export const duplicates = ({ recentMatchingE2E = [] }) => {
  if (recentMatchingE2E.length > 0) {
    return {
      pass: false,
      code: 'DUPLICATE',
      message: `same (originator,end_to_end_id) seen ${recentMatchingE2E.length} time(s) in last 7 days`
    };
  }
  return { pass: true };
};
