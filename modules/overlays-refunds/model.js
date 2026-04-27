const COLS = `id, refund_number, original_transaction_id, refund_transaction_id,
  initiated_by_participant, amount_minor, currency, reason_code, reason_message,
  state, link_signature_b64, link_signature_kid, initiated_at, completed_at`;

export const createRefundsModel = () => ({
  insert: async (
    client,
    {
      id, refundNumber, originalTransactionId, initiatedByParticipant,
      amountMinor, currency, reasonCode, reasonMessage,
      linkSignatureB64, linkSignatureKid
    }
  ) => {
    const r = await client.query(
      `INSERT INTO refunds
         (id, refund_number, original_transaction_id, initiated_by_participant,
          amount_minor, currency, reason_code, reason_message,
          link_signature_b64, link_signature_kid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${COLS}`,
      [
        id, refundNumber, originalTransactionId, initiatedByParticipant,
        amountMinor, currency, reasonCode, reasonMessage ?? null,
        linkSignatureB64, linkSignatureKid
      ]
    );
    return r.rows[0];
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
      `UPDATE refunds SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLS}`,
      params
    );
    return r.rows[0] || null;
  },

  findById: async (client, id) => {
    const r = await client.query(`SELECT ${COLS} FROM refunds WHERE id = $1 LIMIT 1`, [id]);
    return r.rows[0] || null;
  },

  findByNumber: async (client, refundNumber) => {
    const r = await client.query(`SELECT ${COLS} FROM refunds WHERE refund_number = $1 LIMIT 1`, [refundNumber]);
    return r.rows[0] || null;
  },

  listForOriginal: async (client, originalTransactionId) => {
    const r = await client.query(
      `SELECT ${COLS} FROM refunds WHERE original_transaction_id = $1
        ORDER BY initiated_at ASC`,
      [originalTransactionId]
    );
    return r.rows;
  },

  sumCompletedForOriginal: async (client, originalTransactionId) => {
    const r = await client.query(
      `SELECT COALESCE(SUM(amount_minor), 0)::text AS s FROM refunds
        WHERE original_transaction_id = $1 AND state IN ('INITIATED', 'PROCESSING', 'COMPLETED')`,
      [originalTransactionId]
    );
    return r.rows[0]?.s ?? '0';
  },

  list: async (client, { originalTransactionId, state, limit }) => {
    const conds = [];
    const params = [];
    if (originalTransactionId) { params.push(originalTransactionId); conds.push(`original_transaction_id = $${params.length}`); }
    if (state) { params.push(state); conds.push(`state = $${params.length}`); }
    params.push(limit ?? 100);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await client.query(
      `SELECT ${COLS} FROM refunds ${where} ORDER BY initiated_at DESC LIMIT $${params.length}`,
      params
    );
    return r.rows;
  },

  bumpSequence: async (client, bucket) => {
    const r = await client.query(
      `INSERT INTO refund_sequence (bucket, seq) VALUES ($1, 1)
       ON CONFLICT (bucket) DO UPDATE SET seq = refund_sequence.seq + 1
       RETURNING seq`,
      [bucket]
    );
    return r.rows[0].seq;
  }
});
