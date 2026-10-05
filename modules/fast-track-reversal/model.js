const FTR_COLS = `id, original_transaction_id, reversal_transaction_id,
  victim_participant, receiving_participant, invoked_by, invoked_at,
  evidence, state, freeze_attempted_at, receiving_acknowledged_at,
  reason_code, reason_message, resolved_at, metadata`;

export const createFTRModel = () => ({
  insert: async (
    client,
    {
      id,
      originalTransactionId,
      victimParticipant,
      receivingParticipant,
      invokedBy,
      evidence,
      reasonCode,
      reasonMessage
    }
  ) => {
    const r = await client.query(
      `INSERT INTO fast_track_reversals
         (id, original_transaction_id, victim_participant, receiving_participant,
          invoked_by, evidence, reason_code, reason_message)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       RETURNING ${FTR_COLS}`,
      [
        id,
        originalTransactionId,
        victimParticipant,
        receivingParticipant,
        invokedBy ?? null,
        JSON.stringify(evidence || {}),
        reasonCode,
        reasonMessage ?? null
      ]
    );
    return r.rows[0];
  },

  setState: async (client, { id, state, fields }) => {
    const sets = ['state = $2'];
    const params = [id, state];
    if (fields) {
      for (const [col, val] of Object.entries(fields)) {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      }
    }
    const r = await client.query(
      `UPDATE fast_track_reversals SET ${sets.join(', ')} WHERE id = $1 RETURNING ${FTR_COLS}`,
      params
    );
    return r.rows[0] || null;
  },

  findById: async (client, id) => {
    const r = await client.query(
      `SELECT ${FTR_COLS} FROM fast_track_reversals WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  },

  list: async (client, { state, victimParticipant, limit }) => {
    const conds = [];
    const params = [];
    if (state) {
      params.push(state);
      conds.push(`state = $${params.length}`);
    }
    if (victimParticipant) {
      params.push(victimParticipant);
      conds.push(`victim_participant = $${params.length}`);
    }
    params.push(limit);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await client.query(
      `SELECT ${FTR_COLS} FROM fast_track_reversals ${where}
        ORDER BY invoked_at DESC LIMIT $${params.length}`,
      params
    );
    return r.rows;
  },

  // Quota counter — number of invocations from a participant in the
  // current calendar month.
  countInvocationsThisMonth: async (client, participantCode) => {
    const r = await client.query(
      `SELECT count(*)::int AS n FROM fast_track_reversals
        WHERE victim_participant = $1
          AND date_trunc('month', invoked_at) = date_trunc('month', now())`,
      [participantCode]
    );
    return r.rows[0]?.n ?? 0;
  }
});
