const ROUTING_COLS = `id, rule_type, pattern, participant_code, priority, active, notes, created_at, updated_at`;

export const createRoutingModel = () => ({
  insertRule: async (
    client,
    { id, ruleType, pattern, participantCode, priority, notes }
  ) => {
    const r = await client.query(
      `INSERT INTO routing_rules (id, rule_type, pattern, participant_code, priority, active, notes)
       VALUES ($1, $2, $3, $4, $5, true, $6)
       ON CONFLICT (rule_type, pattern, participant_code) DO UPDATE SET
         priority = EXCLUDED.priority,
         active = true,
         notes = EXCLUDED.notes,
         updated_at = now()
       RETURNING ${ROUTING_COLS}`,
      [id, ruleType, pattern, participantCode, priority, notes ?? null]
    );
    return r.rows[0];
  },

  removeRule: async (client, id) => {
    const r = await client.query(
      `DELETE FROM routing_rules WHERE id = $1 RETURNING ${ROUTING_COLS}`,
      [id]
    );
    return r.rows[0] || null;
  },

  list: async (client, { ruleType, participantCode, active }) => {
    const conds = [];
    const params = [];
    if (ruleType) {
      params.push(ruleType);
      conds.push(`rule_type = $${params.length}`);
    }
    if (participantCode) {
      params.push(participantCode);
      conds.push(`participant_code = $${params.length}`);
    }
    if (active !== undefined) {
      params.push(active);
      conds.push(`active = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await client.query(
      `SELECT ${ROUTING_COLS} FROM routing_rules ${where}
        ORDER BY rule_type, priority ASC, length(pattern) DESC`,
      params
    );
    return r.rows;
  },

  loadAllActive: async (client) => {
    const r = await client.query(
      `SELECT ${ROUTING_COLS} FROM routing_rules WHERE active = true`
    );
    return r.rows;
  }
});
