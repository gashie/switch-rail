// All SQL touching transaction_fraud_signals lives here.

const SIGNAL_COLS = `id, transaction_id, source, composite_verdict, composite_score,
  rule_hits, ml_score, ml_features, evaluated_at, evaluated_by`;

export const createSignalsModel = () => ({
  insert: async (
    client,
    {
      id,
      transactionId,
      source,
      compositeVerdict,
      compositeScore,
      ruleHits,
      mlScore,
      mlFeatures,
      evaluatedBy
    }
  ) => {
    const r = await client.query(
      `INSERT INTO transaction_fraud_signals
         (id, transaction_id, source, composite_verdict, composite_score,
          rule_hits, ml_score, ml_features, evaluated_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9)
       RETURNING ${SIGNAL_COLS}`,
      [
        id,
        transactionId,
        source,
        compositeVerdict,
        compositeScore,
        JSON.stringify(ruleHits || []),
        mlScore != null ? mlScore : null,
        mlFeatures ? JSON.stringify(mlFeatures) : null,
        evaluatedBy || 'in-line'
      ]
    );
    return r.rows[0];
  },

  listByTransaction: async (client, transactionId) => {
    const r = await client.query(
      `SELECT ${SIGNAL_COLS} FROM transaction_fraud_signals
        WHERE transaction_id = $1
        ORDER BY evaluated_at ASC`,
      [transactionId]
    );
    return r.rows;
  },

  listRecentByOriginator: async (client, { originatorAccount, withinSeconds, limit = 50 }) => {
    const r = await client.query(
      `SELECT s.${SIGNAL_COLS.split(', ').join(', s.')}, t.originator_participant, t.originator_account
         FROM transaction_fraud_signals s
         JOIN transactions t ON t.id = s.transaction_id
        WHERE t.originator_account = $1
          AND s.evaluated_at >= now() - ($2 || ' seconds')::interval
        ORDER BY s.evaluated_at DESC
        LIMIT $3`,
      [originatorAccount, String(withinSeconds), limit]
    );
    return r.rows;
  }
});
