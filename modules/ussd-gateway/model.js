const COLS = `id, msisdn, short_code, step, input_text, response_text,
  outcome, initiated_at, metadata`;

export const createUssdGatewayModel = () => ({
  insertSession: async (client, { id, msisdn, shortCode, step, inputText, responseText, outcome, metadata }) => {
    const r = await client.query(
      `INSERT INTO ussd_sessions (id, msisdn, short_code, step, input_text, response_text, outcome, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${COLS}`,
      [id, msisdn, shortCode, step, inputText || null, responseText, outcome, metadata || {}]
    );
    return r.rows[0];
  },

  listSessions: async (client, { msisdn, limit }) => {
    const conds = [];
    const params = [];
    if (msisdn) { params.push(msisdn); conds.push(`msisdn = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit);
    const r = await client.query(
      `SELECT ${COLS} FROM ussd_sessions ${where}
        ORDER BY initiated_at DESC LIMIT $${params.length}`,
      params
    );
    return r.rows;
  }
});
