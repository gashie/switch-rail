// r-technical — uphold automatically if reconciliation has flagged this
// transaction with a STATUS_MISMATCH break. STATUS_MISMATCH means the
// participant's records and the rail's records disagree on the credit-leg
// outcome — a textbook technical-issue dispute.

export const rTechnical = async ({ transaction, client }) => {
  const r = await client.query(
    `SELECT id, break_type, rail_state, participant_state, resolution
       FROM reconciliation_breaks
      WHERE rail_transaction_id = $1
        AND break_type = 'STATUS_MISMATCH'
      ORDER BY created_at DESC LIMIT 1`,
    [transaction.id]
  );
  if (r.rows.length === 0) return { resolvable: false };
  return {
    resolvable: true,
    outcome: 'UPHOLD',
    rationaleCode: 'AUTO_TECHNICAL_RECON_BREAK',
    notes: `recon break ${r.rows[0].id}: rail=${r.rows[0].rail_state}, participant=${r.rows[0].participant_state}`
  };
};
