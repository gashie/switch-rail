const COLS = `id, escrow_number, payer_participant, payer_account_id,
  payee_participant, payee_account_id, amount_minor, currency,
  release_condition, release_at, arbiter_user_id, state,
  hold_transaction_id, release_transaction_id,
  payer_signed_at, payee_signed_at, released_at, refunded_at,
  reason, metadata, created_at`;

export const createEscrowModel = () => ({
  insert: async (
    client,
    {
      id, escrowNumber, payerParticipant, payerAccountId,
      payeeParticipant, payeeAccountId, amountMinor, currency,
      releaseCondition, releaseAt, arbiterUserId, reason
    }
  ) => {
    const r = await client.query(
      `INSERT INTO escrow_holds
         (id, escrow_number, payer_participant, payer_account_id,
          payee_participant, payee_account_id, amount_minor, currency,
          release_condition, release_at, arbiter_user_id, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING ${COLS}`,
      [
        id, escrowNumber, payerParticipant, payerAccountId,
        payeeParticipant, payeeAccountId, amountMinor, currency,
        releaseCondition, releaseAt ?? null, arbiterUserId ?? null,
        reason ?? null
      ]
    );
    return r.rows[0];
  },

  findById: async (client, id) => {
    const r = await client.query(`SELECT ${COLS} FROM escrow_holds WHERE id = $1`, [id]);
    return r.rows[0] || null;
  },

  findByNumber: async (client, escrowNumber) => {
    const r = await client.query(`SELECT ${COLS} FROM escrow_holds WHERE escrow_number = $1`, [escrowNumber]);
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
      `UPDATE escrow_holds SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLS}`,
      params
    );
    return r.rows[0] || null;
  },

  list: async (client, { payerParticipant, payeeParticipant, state, limit }) => {
    const conds = [];
    const params = [];
    if (payerParticipant) { params.push(payerParticipant); conds.push(`payer_participant = $${params.length}`); }
    if (payeeParticipant) { params.push(payeeParticipant); conds.push(`payee_participant = $${params.length}`); }
    if (state) { params.push(state); conds.push(`state = $${params.length}`); }
    params.push(limit ?? 100);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await client.query(
      `SELECT ${COLS} FROM escrow_holds ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    return r.rows;
  },

  pickDueTimeElapsed: async (client, limit = 100) => {
    const r = await client.query(
      `SELECT ${COLS} FROM escrow_holds
        WHERE state = 'HELD' AND release_condition = 'TIME_ELAPSED'
          AND release_at IS NOT NULL AND release_at <= now()
        ORDER BY release_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $1`,
      [limit]
    );
    return r.rows;
  },

  bumpSequence: async (client, bucket) => {
    const r = await client.query(
      `INSERT INTO escrow_sequence (bucket, seq) VALUES ($1, 1)
       ON CONFLICT (bucket) DO UPDATE SET seq = escrow_sequence.seq + 1
       RETURNING seq`,
      [bucket]
    );
    return r.rows[0].seq;
  }
});
