const ALERT_COLS = `id, alert_type, account_keys, detected_at, evidence,
  composite_score, status, resolved_by, resolved_at, resolution_notes`;

export const createAlertsModel = () => ({
  insertAlert: async (
    client,
    { id, alertType, accountKeys, evidence, compositeScore }
  ) => {
    const r = await client.query(
      `INSERT INTO graph_alerts
         (id, alert_type, account_keys, evidence, composite_score)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING ${ALERT_COLS}`,
      [id, alertType, accountKeys, JSON.stringify(evidence || {}), compositeScore]
    );
    return r.rows[0];
  },

  findById: async (client, id) => {
    const r = await client.query(
      `SELECT ${ALERT_COLS} FROM graph_alerts WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  },

  listAlerts: async (client, { alertType, status, limit }) => {
    const conds = [];
    const params = [];
    if (alertType) {
      params.push(alertType);
      conds.push(`alert_type = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conds.push(`status = $${params.length}`);
    }
    params.push(limit);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await client.query(
      `SELECT ${ALERT_COLS} FROM graph_alerts ${where}
        ORDER BY detected_at DESC LIMIT $${params.length}`,
      params
    );
    return r.rows;
  },

  updateStatus: async (client, { id, status, resolvedBy, notes }) => {
    const r = await client.query(
      `UPDATE graph_alerts
          SET status = $2,
              resolved_by = $3,
              resolved_at = CASE WHEN $2 IN ('confirmed','dismissed') THEN now() ELSE resolved_at END,
              resolution_notes = COALESCE($4, resolution_notes)
        WHERE id = $1
        RETURNING ${ALERT_COLS}`,
      [id, status, resolvedBy ?? null, notes ?? null]
    );
    return r.rows[0] || null;
  },

  // Has the given account been involved in any confirmed MULE_RING alert?
  // Used by the rule context builder to populate signals.networkGraphFlag.
  isAccountInConfirmedMuleRing: async (client, accountKey) => {
    const r = await client.query(
      `SELECT 1 FROM graph_alerts
        WHERE alert_type = 'MULE_RING'
          AND status = 'confirmed'
          AND $1 = ANY(account_keys)
        LIMIT 1`,
      [accountKey]
    );
    return r.rows.length > 0;
  }
});
