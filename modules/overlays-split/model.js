const SPLIT_COLS = `id, split_number, payer_participant, payer_account_id,
  total_amount_minor, currency, state, reference, master_transaction_id,
  created_at, completed_at`;

const LEG_COLS = `id, split_id, leg_index, beneficiary_participant,
  beneficiary_account_id, amount_minor, description, transaction_id, result`;

export const createSplitModel = () => ({
  insertSplit: async (
    client,
    {
      id, splitNumber, payerParticipant, payerAccountId,
      totalAmountMinor, currency, reference
    }
  ) => {
    const r = await client.query(
      `INSERT INTO split_instructions
         (id, split_number, payer_participant, payer_account_id,
          total_amount_minor, currency, reference)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${SPLIT_COLS}`,
      [
        id, splitNumber, payerParticipant, payerAccountId,
        totalAmountMinor, currency, reference ?? null
      ]
    );
    return r.rows[0];
  },

  insertLeg: async (
    client,
    {
      id, splitId, legIndex, beneficiaryParticipant, beneficiaryAccountId,
      amountMinor, description
    }
  ) => {
    const r = await client.query(
      `INSERT INTO split_legs
         (id, split_id, leg_index, beneficiary_participant,
          beneficiary_account_id, amount_minor, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${LEG_COLS}`,
      [
        id, splitId, legIndex, beneficiaryParticipant, beneficiaryAccountId,
        amountMinor, description ?? null
      ]
    );
    return r.rows[0];
  },

  setLegResult: async (client, { id, transactionId, result }) => {
    const r = await client.query(
      `UPDATE split_legs SET transaction_id = $2, result = $3
        WHERE id = $1 RETURNING ${LEG_COLS}`,
      [id, transactionId ?? null, result]
    );
    return r.rows[0] || null;
  },

  setSplitState: async (client, { id, toState, fields }) => {
    const sets = ['state = $2'];
    const params = [id, toState];
    if (fields) {
      for (const [col, val] of Object.entries(fields)) {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      }
    }
    const r = await client.query(
      `UPDATE split_instructions SET ${sets.join(', ')} WHERE id = $1 RETURNING ${SPLIT_COLS}`,
      params
    );
    return r.rows[0] || null;
  },

  findSplitById: async (client, id) => {
    const r = await client.query(`SELECT ${SPLIT_COLS} FROM split_instructions WHERE id = $1`, [id]);
    return r.rows[0] || null;
  },

  findSplitByNumber: async (client, splitNumber) => {
    const r = await client.query(`SELECT ${SPLIT_COLS} FROM split_instructions WHERE split_number = $1`, [splitNumber]);
    return r.rows[0] || null;
  },

  listLegs: async (client, splitId) => {
    const r = await client.query(
      `SELECT ${LEG_COLS} FROM split_legs WHERE split_id = $1 ORDER BY leg_index ASC`,
      [splitId]
    );
    return r.rows;
  },

  listSplits: async (client, { payerParticipant, state, limit }) => {
    const conds = [];
    const params = [];
    if (payerParticipant) { params.push(payerParticipant); conds.push(`payer_participant = $${params.length}`); }
    if (state) { params.push(state); conds.push(`state = $${params.length}`); }
    params.push(limit ?? 100);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await client.query(
      `SELECT ${SPLIT_COLS} FROM split_instructions ${where}
        ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    return r.rows;
  },

  bumpSequence: async (client, bucket) => {
    const r = await client.query(
      `INSERT INTO split_sequence (bucket, seq) VALUES ($1, 1)
       ON CONFLICT (bucket) DO UPDATE SET seq = split_sequence.seq + 1
       RETURNING seq`,
      [bucket]
    );
    return r.rows[0].seq;
  }
});
