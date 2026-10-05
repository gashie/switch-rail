const COLS = `id, request_number, requester_participant, requester_account_id,
  payer_participant, payer_account_id, payer_alias_type, payer_alias_value,
  amount_minor, currency, reason, reference, state, expires_at,
  authorized_at, paid_transaction_id, rejected_reason, idempotency_key,
  created_at, updated_at`;

export const createR2pModel = () => ({
  insert: async (
    client,
    {
      id, requestNumber, requesterParticipant, requesterAccountId,
      payerParticipant, payerAccountId, payerAliasType, payerAliasValue,
      amountMinor, currency, reason, reference, expiresAt, idempotencyKey
    }
  ) => {
    const r = await client.query(
      `INSERT INTO r2p_requests
         (id, request_number, requester_participant, requester_account_id,
          payer_participant, payer_account_id, payer_alias_type, payer_alias_value,
          amount_minor, currency, reason, reference, expires_at, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (requester_participant, idempotency_key)
         WHERE idempotency_key IS NOT NULL
         DO NOTHING
       RETURNING ${COLS}`,
      [
        id, requestNumber, requesterParticipant, requesterAccountId,
        payerParticipant, payerAccountId ?? null, payerAliasType ?? null, payerAliasValue ?? null,
        amountMinor, currency, reason ?? null, reference ?? null, expiresAt,
        idempotencyKey ?? null
      ]
    );
    return r.rows[0] || null;
  },

  findByIdemKey: async (client, { requesterParticipant, idempotencyKey }) => {
    const r = await client.query(
      `SELECT ${COLS} FROM r2p_requests
        WHERE requester_participant = $1 AND idempotency_key = $2 LIMIT 1`,
      [requesterParticipant, idempotencyKey]
    );
    return r.rows[0] || null;
  },

  findByRequestNumber: async (client, requestNumber) => {
    const r = await client.query(
      `SELECT ${COLS} FROM r2p_requests WHERE request_number = $1 LIMIT 1`,
      [requestNumber]
    );
    return r.rows[0] || null;
  },

  findById: async (client, id) => {
    const r = await client.query(
      `SELECT ${COLS} FROM r2p_requests WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  },

  setState: async (client, { id, toState, fields }) => {
    const sets = ['state = $2', 'updated_at = now()'];
    const params = [id, toState];
    if (fields) {
      for (const [col, val] of Object.entries(fields)) {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      }
    }
    const r = await client.query(
      `UPDATE r2p_requests SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLS}`,
      params
    );
    return r.rows[0] || null;
  },

  list: async (client, { payerParticipant, requesterParticipant, state, limit, offset }) => {
    const conds = [];
    const params = [];
    if (payerParticipant) { params.push(payerParticipant); conds.push(`payer_participant = $${params.length}`); }
    if (requesterParticipant) { params.push(requesterParticipant); conds.push(`requester_participant = $${params.length}`); }
    if (state) { params.push(state); conds.push(`state = $${params.length}`); }
    params.push(limit ?? 100);
    params.push(offset ?? 0);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await client.query(
      `SELECT ${COLS} FROM r2p_requests ${where}
        ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows;
  },

  bumpSequence: async (client, bucket) => {
    const r = await client.query(
      `INSERT INTO r2p_request_sequence (bucket, seq) VALUES ($1, 1)
       ON CONFLICT (bucket) DO UPDATE SET seq = r2p_request_sequence.seq + 1
       RETURNING seq`,
      [bucket]
    );
    return r.rows[0].seq;
  },

  expirePending: async (client, limit = 500) => {
    const r = await client.query(
      `UPDATE r2p_requests SET state = 'EXPIRED', updated_at = now()
        WHERE id IN (
          SELECT id FROM r2p_requests
          WHERE state = 'PENDING' AND expires_at <= now()
          ORDER BY expires_at ASC LIMIT $1
        )
        RETURNING ${COLS}`,
      [limit]
    );
    return r.rows;
  }
});
