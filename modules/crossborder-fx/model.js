const QUOTE_COLS = `id, pay_currency, receive_currency, pay_amount_minor,
  receive_amount_minor, rate_decimal_str, market_maker_id, fee_pay_minor,
  fee_receive_minor, state, quoted_at, expires_at, consumed_transaction_id,
  metadata`;

const MAKER_COLS = `id, maker_code, maker_name, supported_pairs, endpoints,
  priority, active, metadata, created_at`;

export const createFxModel = () => ({
  insertQuote: async (
    client,
    {
      id, payCurrency, receiveCurrency, payAmountMinor, receiveAmountMinor,
      rateDecimalStr, marketMakerId, feePayMinor, feeReceiveMinor, expiresAt,
      metadata
    }
  ) => {
    const r = await client.query(
      `INSERT INTO fx_quotes
         (id, pay_currency, receive_currency, pay_amount_minor, receive_amount_minor,
          rate_decimal_str, market_maker_id, fee_pay_minor, fee_receive_minor,
          expires_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       RETURNING ${QUOTE_COLS}`,
      [
        id, payCurrency, receiveCurrency, payAmountMinor, receiveAmountMinor,
        rateDecimalStr, marketMakerId ?? null, feePayMinor || '0', feeReceiveMinor || '0',
        expiresAt, JSON.stringify(metadata || {})
      ]
    );
    return r.rows[0];
  },

  findQuoteById: async (client, id) => {
    const r = await client.query(`SELECT ${QUOTE_COLS} FROM fx_quotes WHERE id = $1 LIMIT 1`, [id]);
    return r.rows[0] || null;
  },

  setQuoteState: async (client, { id, toState, fields }) => {
    const sets = ['state = $2'];
    const params = [id, toState];
    if (fields) {
      for (const [col, val] of Object.entries(fields)) {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      }
    }
    const r = await client.query(
      `UPDATE fx_quotes SET ${sets.join(', ')} WHERE id = $1 RETURNING ${QUOTE_COLS}`,
      params
    );
    return r.rows[0] || null;
  },

  expirePastDue: async (client, limit = 500) => {
    const r = await client.query(
      `UPDATE fx_quotes SET state = 'EXPIRED'
        WHERE id IN (
          SELECT id FROM fx_quotes
          WHERE state IN ('OPEN', 'LOCKED') AND expires_at <= now()
          ORDER BY expires_at ASC LIMIT $1
        )
        RETURNING ${QUOTE_COLS}`,
      [limit]
    );
    return r.rows;
  },

  insertMaker: async (
    client,
    { id, makerCode, makerName, supportedPairs, endpoints, priority, metadata }
  ) => {
    const r = await client.query(
      `INSERT INTO fx_market_makers
         (id, maker_code, maker_name, supported_pairs, endpoints, priority, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb)
       ON CONFLICT (maker_code) DO NOTHING
       RETURNING ${MAKER_COLS}`,
      [
        id, makerCode, makerName, supportedPairs,
        JSON.stringify(endpoints), priority, JSON.stringify(metadata || {})
      ]
    );
    return r.rows[0] || null;
  },

  findActiveMakerForPair: async (client, pair) => {
    const r = await client.query(
      `SELECT ${MAKER_COLS} FROM fx_market_makers
        WHERE active = true AND $1 = ANY(supported_pairs)
        ORDER BY priority ASC, created_at ASC LIMIT 1`,
      [pair]
    );
    return r.rows[0] || null;
  },

  listMakers: async (client) => {
    const r = await client.query(
      `SELECT ${MAKER_COLS} FROM fx_market_makers ORDER BY priority ASC, maker_code ASC`
    );
    return r.rows;
  }
});
