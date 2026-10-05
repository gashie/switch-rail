// r-fraud — uphold automatically if a fast-track-reversal already completed
// for this transaction. The fast-track flow is a stronger, faster signal:
// if the rail already froze the receiving leg and an operator confirmed the
// reversal, a subsequent FRAUD dispute is redundant and clearly upheld.

export const rFraud = async ({ caseRow, client }) => {
  const r = await client.query(
    `SELECT id, state FROM fast_track_reversals
      WHERE original_transaction_id = $1
        AND state IN ('completed', 'frozen')
      ORDER BY invoked_at DESC LIMIT 1`,
    [caseRow.transaction_id]
  );
  if (r.rows.length === 0) return { resolvable: false };
  return {
    resolvable: true,
    outcome: 'UPHOLD',
    rationaleCode: 'AUTO_FRAUD_FASTTRACK_COMPLETED',
    notes: `fast-track ${r.rows[0].id} in state ${r.rows[0].state}`
  };
};
