// r-duplicate — uphold automatically if a second confirmed transaction
// matches the original on (originator, beneficiary_participant,
// beneficiary_account, amount_value, amount_currency) within a 60-second
// window. This is the textbook double-charge case: same envelope replayed
// outside the idempotency key, same merchant got paid twice.

export const rDuplicate = async ({ caseRow, transaction, client }) => {
  const r = await client.query(
    `SELECT id, created_at, end_to_end_id FROM transactions
      WHERE id <> $1
        AND originator_participant = $2
        AND originator_account = $3
        AND beneficiary_participant = $4
        AND beneficiary_account = $5
        AND amount_value = $6
        AND amount_currency = $7
        AND state IN ('CONFIRMED', 'REVERSED')
        AND ABS(EXTRACT(EPOCH FROM (created_at - $8::timestamptz))) <= 60
      LIMIT 1`,
    [
      transaction.id,
      transaction.originator_participant,
      transaction.originator_account,
      transaction.beneficiary_participant,
      transaction.beneficiary_account,
      transaction.amount_value,
      transaction.amount_currency,
      transaction.created_at instanceof Date
        ? transaction.created_at.toISOString()
        : transaction.created_at
    ]
  );
  if (r.rows.length === 0) return { resolvable: false };
  void caseRow;
  return {
    resolvable: true,
    outcome: 'UPHOLD',
    rationaleCode: 'AUTO_DUPLICATE_MATCH_FOUND',
    notes: `duplicate of tx ${r.rows[0].id} (e2e=${r.rows[0].end_to_end_id})`
  };
};
