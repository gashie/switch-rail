// Reversals don't add a new table — they live in transactions with
// `original_transaction_id` pointing at the CONFIRMED row being unwound.
// All persistence flows through the transactions model. The queries here
// are the reversal-specific lookups: by ID and by original.

const TX_COLS = `id, envelope_id, end_to_end_id, state, rail_class,
  originator_participant, originator_account,
  beneficiary_participant, beneficiary_account,
  amount_value, amount_currency,
  response_code, reason_code, reason_message,
  authorized_at, routed_at, credit_leg_started_at,
  confirmed_at, rejected_at, reversed_at, failed_at,
  reversal_transaction_id, original_transaction_id,
  attempts, next_attempt_at, retry_policy_name,
  created_at, updated_at`;

export const createReversalsModel = () => ({
  findById: async (client, id) => {
    const r = await client.query(
      `SELECT ${TX_COLS} FROM transactions WHERE id = $1 AND original_transaction_id IS NOT NULL LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  },

  listByOriginal: async (client, originalTransactionId) => {
    const r = await client.query(
      `SELECT ${TX_COLS} FROM transactions
        WHERE original_transaction_id = $1
        ORDER BY created_at ASC`,
      [originalTransactionId]
    );
    return r.rows;
  },

  setReversalLink: async (client, originalTxId, reversalTxId) => {
    await client.query(
      `UPDATE transactions
          SET reversal_transaction_id = $2, updated_at = now()
        WHERE id = $1`,
      [originalTxId, reversalTxId]
    );
  }
});
