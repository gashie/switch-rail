const COLS = `id, mandate_number, payer_participant, payer_account_id,
  payee_participant, payee_account_id, per_debit_cap_minor,
  daily_cap_minor, monthly_cap_minor, total_cap_minor, currency,
  frequency, reference, description, state, authorized_at,
  effective_from, effective_to, next_scheduled_at,
  total_debited_minor, total_debit_count, last_debited_at,
  revoked_at, revoked_by, metadata`;

export const createMandatesModel = () => ({
  insert: async (
    client,
    {
      id, mandateNumber, payerParticipant, payerAccountId,
      payeeParticipant, payeeAccountId, perDebitCapMinor,
      dailyCapMinor, monthlyCapMinor, totalCapMinor, currency,
      frequency, reference, description, effectiveFrom, effectiveTo,
      nextScheduledAt
    }
  ) => {
    const r = await client.query(
      `INSERT INTO mandates
         (id, mandate_number, payer_participant, payer_account_id,
          payee_participant, payee_account_id, per_debit_cap_minor,
          daily_cap_minor, monthly_cap_minor, total_cap_minor, currency,
          frequency, reference, description, effective_from, effective_to,
          next_scheduled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING ${COLS}`,
      [
        id, mandateNumber, payerParticipant, payerAccountId,
        payeeParticipant, payeeAccountId, perDebitCapMinor,
        dailyCapMinor ?? null, monthlyCapMinor ?? null, totalCapMinor ?? null,
        currency, frequency, reference ?? null, description ?? null,
        effectiveFrom, effectiveTo ?? null, nextScheduledAt ?? null
      ]
    );
    return r.rows[0];
  },

  findById: async (client, id) => {
    const r = await client.query(`SELECT ${COLS} FROM mandates WHERE id = $1 LIMIT 1`, [id]);
    return r.rows[0] || null;
  },

  findByNumber: async (client, mandateNumber) => {
    const r = await client.query(`SELECT ${COLS} FROM mandates WHERE mandate_number = $1 LIMIT 1`, [mandateNumber]);
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
      `UPDATE mandates SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLS}`,
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
      `SELECT ${COLS} FROM mandates ${where} ORDER BY authorized_at DESC LIMIT $${params.length}`,
      params
    );
    return r.rows;
  },

  // Pick due mandates for the scheduler. SELECT FOR UPDATE SKIP LOCKED so
  // multiple worker shards don't double-process.
  pickDue: async (client, limit = 100) => {
    const r = await client.query(
      `SELECT ${COLS} FROM mandates
        WHERE state = 'ACTIVE'
          AND frequency != 'AS_PRESENTED'
          AND next_scheduled_at IS NOT NULL
          AND next_scheduled_at <= now()
        ORDER BY next_scheduled_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $1`,
      [limit]
    );
    return r.rows;
  },

  insertDebit: async (
    client,
    { id, mandateId, transactionId, presentedAmountMinor, result, resultMessage }
  ) => {
    const r = await client.query(
      `INSERT INTO mandate_debits
         (id, mandate_id, transaction_id, presented_amount_minor, result, result_message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, mandate_id, transaction_id, presented_amount_minor, result, result_message, presented_at`,
      [id, mandateId, transactionId ?? null, presentedAmountMinor, result, resultMessage ?? null]
    );
    return r.rows[0];
  },

  // Sum of successful debits within a window.
  sumSuccessfulDebitsSince: async (client, { mandateId, since }) => {
    const r = await client.query(
      `SELECT COALESCE(SUM(presented_amount_minor), 0)::text AS s FROM mandate_debits
        WHERE mandate_id = $1 AND result = 'SUCCESS' AND presented_at >= $2::timestamptz`,
      [mandateId, since]
    );
    return r.rows[0]?.s ?? '0';
  },

  listDebits: async (client, mandateId, limit = 100) => {
    const r = await client.query(
      `SELECT id, mandate_id, transaction_id, presented_amount_minor, result, result_message, presented_at
       FROM mandate_debits WHERE mandate_id = $1 ORDER BY presented_at DESC LIMIT $2`,
      [mandateId, limit]
    );
    return r.rows;
  },

  applyDebitTotals: async (client, { mandateId, presentedAmountMinor }) => {
    const r = await client.query(
      `UPDATE mandates
          SET total_debited_minor = total_debited_minor + $2::numeric,
              total_debit_count   = total_debit_count + 1,
              last_debited_at     = now()
        WHERE id = $1
        RETURNING ${COLS}`,
      [mandateId, presentedAmountMinor]
    );
    return r.rows[0];
  },

  bumpSequence: async (client, bucket) => {
    const r = await client.query(
      `INSERT INTO mandate_sequence (bucket, seq) VALUES ($1, 1)
       ON CONFLICT (bucket) DO UPDATE SET seq = mandate_sequence.seq + 1
       RETURNING seq`,
      [bucket]
    );
    return r.rows[0].seq;
  }
});
