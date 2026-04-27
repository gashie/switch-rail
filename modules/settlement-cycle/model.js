const CYCLE_COLS = `id, cycle_type, currency, operating_date, triggered_by,
  triggered_reason, state, started_at, completed_at,
  net_movement_count, total_dr_minor, total_cr_minor,
  rtgs_output_path, created_at`;

const MOVEMENT_COLS = `id, cycle_id, participant_code, currency,
  net_position_minor, movement_minor, posted_journal_id`;

export const createCycleModel = () => ({
  insertCycle: async (
    client,
    { id, cycleType, currency, operatingDate, triggeredBy, triggeredReason }
  ) => {
    const r = await client.query(
      `INSERT INTO settlement_cycles
         (id, cycle_type, currency, operating_date, triggered_by, triggered_reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${CYCLE_COLS}`,
      [id, cycleType, currency, operatingDate, triggeredBy, triggeredReason ?? null]
    );
    return r.rows[0];
  },

  findById: async (client, id) => {
    const r = await client.query(
      `SELECT ${CYCLE_COLS} FROM settlement_cycles WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  },

  // Lock the cycle row before mutating state — prevents two workers from
  // both flipping pending → running on the same row.
  findByIdForUpdate: async (client, id) => {
    const r = await client.query(
      `SELECT ${CYCLE_COLS} FROM settlement_cycles WHERE id = $1 FOR UPDATE`,
      [id]
    );
    return r.rows[0] || null;
  },

  updateState: async (client, { id, state, fields }) => {
    const sets = ['state = $2'];
    const params = [id, state];
    if (fields) {
      for (const [col, val] of Object.entries(fields)) {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      }
    }
    const r = await client.query(
      `UPDATE settlement_cycles SET ${sets.join(', ')} WHERE id = $1 RETURNING ${CYCLE_COLS}`,
      params
    );
    return r.rows[0] || null;
  },

  listCycles: async (
    client,
    { cycleType, currency, operatingDate, state, limit }
  ) => {
    const conds = [];
    const params = [];
    if (cycleType) {
      params.push(cycleType);
      conds.push(`cycle_type = $${params.length}`);
    }
    if (currency) {
      params.push(currency);
      conds.push(`currency = $${params.length}`);
    }
    if (operatingDate) {
      params.push(operatingDate);
      conds.push(`operating_date = $${params.length}`);
    }
    if (state) {
      params.push(state);
      conds.push(`state = $${params.length}`);
    }
    params.push(limit);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await client.query(
      `SELECT ${CYCLE_COLS} FROM settlement_cycles ${where}
        ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    return r.rows;
  },

  insertMovement: async (
    client,
    { id, cycleId, participantCode, currency, netPositionMinor, movementMinor, postedJournalId }
  ) => {
    const r = await client.query(
      `INSERT INTO settlement_cycle_movements
         (id, cycle_id, participant_code, currency, net_position_minor, movement_minor, posted_journal_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${MOVEMENT_COLS}`,
      [
        id,
        cycleId,
        participantCode,
        currency,
        String(netPositionMinor),
        String(movementMinor),
        postedJournalId ?? null
      ]
    );
    return r.rows[0];
  },

  listMovements: async (client, cycleId) => {
    const r = await client.query(
      `SELECT ${MOVEMENT_COLS} FROM settlement_cycle_movements
        WHERE cycle_id = $1
        ORDER BY participant_code ASC`,
      [cycleId]
    );
    return r.rows;
  }
});
