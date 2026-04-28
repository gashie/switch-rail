const COLS = `id, transaction_id, foreign_rail_code, foreign_tx_id,
  fx_quote_id, pay_currency, receive_currency, pay_amount_minor,
  receive_amount_minor, state, leg_1_journal_id, leg_2_journal_id,
  compensate_journal_id, travel_rule_payload, settlement_asset_type,
  initiated_at, foreign_response_at, confirmed_at, rejected_at,
  attempts, next_attempt_at, metadata`;

export const createCrossborderTxModel = () => ({
  insert: async (
    client,
    {
      id, transactionId, foreignRailCode, fxQuoteId, payCurrency,
      receiveCurrency, payAmountMinor, receiveAmountMinor,
      travelRulePayload, settlementAssetType, leg1JournalId, leg2JournalId,
      state, metadata
    }
  ) => {
    const r = await client.query(
      `INSERT INTO crossborder_transactions
         (id, transaction_id, foreign_rail_code, fx_quote_id, pay_currency,
          receive_currency, pay_amount_minor, receive_amount_minor,
          travel_rule_payload, settlement_asset_type, leg_1_journal_id,
          leg_2_journal_id, state, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14::jsonb)
       ON CONFLICT (transaction_id) DO NOTHING
       RETURNING ${COLS}`,
      [
        id, transactionId, foreignRailCode, fxQuoteId, payCurrency,
        receiveCurrency, payAmountMinor, receiveAmountMinor,
        JSON.stringify(travelRulePayload || {}), settlementAssetType,
        leg1JournalId ?? null, leg2JournalId ?? null,
        state || 'INITIATED', JSON.stringify(metadata || {})
      ]
    );
    return r.rows[0] || null;
  },

  findById: async (client, id) => {
    const r = await client.query(`SELECT ${COLS} FROM crossborder_transactions WHERE id = $1 LIMIT 1`, [id]);
    return r.rows[0] || null;
  },

  findByTxId: async (client, transactionId) => {
    const r = await client.query(
      `SELECT ${COLS} FROM crossborder_transactions WHERE transaction_id = $1 LIMIT 1`,
      [transactionId]
    );
    return r.rows[0] || null;
  },

  setState: async (client, { id, toState, fields }) => {
    const sets = ['state = $2'];
    const params = [id, toState];
    if (fields) {
      for (const [col, val] of Object.entries(fields)) {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      }
    }
    const r = await client.query(
      `UPDATE crossborder_transactions SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLS}`,
      params
    );
    return r.rows[0] || null;
  },

  pickPendingForeign: async (client, { limit = 20 } = {}) => {
    const r = await client.query(
      `SELECT ${COLS} FROM crossborder_transactions
        WHERE state IN ('FOREIGN_INSTRUCTING', 'PENDING_FOREIGN')
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY initiated_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $1`,
      [limit]
    );
    return r.rows;
  },

  // Counter durability: separate-connection bump for foreign-rail retry counter.
  bumpAttempt: async (client, { id, nextAttemptAt }) => {
    const r = await client.query(
      `UPDATE crossborder_transactions
          SET attempts = attempts + 1,
              next_attempt_at = $2
        WHERE id = $1 RETURNING ${COLS}`,
      [id, nextAttemptAt ?? null]
    );
    return r.rows[0] || null;
  }
});
