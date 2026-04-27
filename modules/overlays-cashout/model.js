const COLS = `id, request_number, customer_participant, customer_account_id,
  agent_participant, agent_float_account_id, amount_minor, currency, state,
  expires_at, authorized_at, completed_at, cancelled_at, transaction_id,
  agent_otp, agent_otp_expires_at, agent_otp_attempts, metadata, created_at`;

export const createCashoutModel = () => ({
  insert: async (
    client,
    {
      id, requestNumber, customerParticipant, customerAccountId,
      agentParticipant, agentFloatAccountId, amountMinor, currency,
      expiresAt, otp, otpExpiresAt
    }
  ) => {
    const r = await client.query(
      `INSERT INTO cashout_requests
         (id, request_number, customer_participant, customer_account_id,
          agent_participant, agent_float_account_id, amount_minor, currency,
          expires_at, agent_otp, agent_otp_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${COLS}`,
      [
        id, requestNumber, customerParticipant, customerAccountId,
        agentParticipant, agentFloatAccountId, amountMinor, currency,
        expiresAt, otp ?? null, otpExpiresAt ?? null
      ]
    );
    return r.rows[0];
  },

  findById: async (client, id) => {
    const r = await client.query(`SELECT ${COLS} FROM cashout_requests WHERE id = $1 LIMIT 1`, [id]);
    return r.rows[0] || null;
  },

  findByNumber: async (client, requestNumber) => {
    const r = await client.query(`SELECT ${COLS} FROM cashout_requests WHERE request_number = $1`, [requestNumber]);
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
      `UPDATE cashout_requests SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLS}`,
      params
    );
    return r.rows[0] || null;
  },

  // Counter durability: increment OTP attempts on a row.
  bumpOtpAttempt: async (client, id) => {
    const r = await client.query(
      `UPDATE cashout_requests SET agent_otp_attempts = agent_otp_attempts + 1
        WHERE id = $1 RETURNING ${COLS}`,
      [id]
    );
    return r.rows[0] || null;
  },

  list: async (client, { customerParticipant, agentParticipant, state, limit }) => {
    const conds = [];
    const params = [];
    if (customerParticipant) { params.push(customerParticipant); conds.push(`customer_participant = $${params.length}`); }
    if (agentParticipant) { params.push(agentParticipant); conds.push(`agent_participant = $${params.length}`); }
    if (state) { params.push(state); conds.push(`state = $${params.length}`); }
    params.push(limit ?? 100);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await client.query(
      `SELECT ${COLS} FROM cashout_requests ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    return r.rows;
  },

  expirePast: async (client, limit = 500) => {
    const r = await client.query(
      `UPDATE cashout_requests SET state = 'EXPIRED'
        WHERE id IN (
          SELECT id FROM cashout_requests
          WHERE state IN ('INITIATED', 'AUTHORIZED') AND expires_at <= now()
          ORDER BY expires_at ASC LIMIT $1
        )
        RETURNING ${COLS}`,
      [limit]
    );
    return r.rows;
  },

  bumpSequence: async (client, bucket) => {
    const r = await client.query(
      `INSERT INTO cashout_request_sequence (bucket, seq) VALUES ($1, 1)
       ON CONFLICT (bucket) DO UPDATE SET seq = cashout_request_sequence.seq + 1
       RETURNING seq`,
      [bucket]
    );
    return r.rows[0].seq;
  }
});
