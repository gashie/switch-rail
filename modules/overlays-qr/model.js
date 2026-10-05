const COLS = `id, qr_type, merchant_participant, merchant_account_id,
  merchant_alias_type, merchant_alias_value, merchant_name, merchant_city,
  mcc, amount_minor, currency, reference, expires_at, encoded_payload,
  state, consumed_transaction_id, created_at`;

export const createQrModel = () => ({
  insert: async (
    client,
    {
      id, qrType, merchantParticipant, merchantAccountId,
      merchantAliasType, merchantAliasValue, merchantName, merchantCity,
      mcc, amountMinor, currency, reference, expiresAt, encodedPayload
    }
  ) => {
    const r = await client.query(
      `INSERT INTO qr_codes
         (id, qr_type, merchant_participant, merchant_account_id,
          merchant_alias_type, merchant_alias_value, merchant_name, merchant_city,
          mcc, amount_minor, currency, reference, expires_at, encoded_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING ${COLS}`,
      [
        id, qrType, merchantParticipant, merchantAccountId,
        merchantAliasType ?? null, merchantAliasValue ?? null,
        merchantName, merchantCity ?? null,
        mcc, amountMinor ?? null, currency, reference ?? null, expiresAt ?? null, encodedPayload
      ]
    );
    return r.rows[0];
  },

  findByEncoded: async (client, encodedPayload) => {
    const r = await client.query(
      `SELECT ${COLS} FROM qr_codes WHERE encoded_payload = $1 LIMIT 1`,
      [encodedPayload]
    );
    return r.rows[0] || null;
  },

  findById: async (client, id) => {
    const r = await client.query(
      `SELECT ${COLS} FROM qr_codes WHERE id = $1 LIMIT 1`,
      [id]
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
      `UPDATE qr_codes SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLS}`,
      params
    );
    return r.rows[0] || null;
  },

  list: async (client, { merchantParticipant, qrType, state, limit }) => {
    const conds = [];
    const params = [];
    if (merchantParticipant) { params.push(merchantParticipant); conds.push(`merchant_participant = $${params.length}`); }
    if (qrType) { params.push(qrType); conds.push(`qr_type = $${params.length}`); }
    if (state) { params.push(state); conds.push(`state = $${params.length}`); }
    params.push(limit ?? 100);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await client.query(
      `SELECT ${COLS} FROM qr_codes ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    return r.rows;
  }
});
