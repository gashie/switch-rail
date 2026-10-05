const OVERRIDE_COLS =
  'id, participant_code, account_number, behavior, reason_code, delay_ms, created_at';

export const createSimulatorModel = () => ({
  upsertOverride: async (
    client,
    { id, participantCode, accountNumber, behavior, reasonCode, delayMs }
  ) => {
    const r = await client.query(
      `INSERT INTO simulator_overrides
         (id, participant_code, account_number, behavior, reason_code, delay_ms)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (participant_code, account_number) DO UPDATE SET
         behavior = EXCLUDED.behavior,
         reason_code = EXCLUDED.reason_code,
         delay_ms = EXCLUDED.delay_ms
       RETURNING ${OVERRIDE_COLS}`,
      [id, participantCode, accountNumber, behavior, reasonCode ?? null, delayMs]
    );
    return r.rows[0];
  },

  findOverride: async (client, { participantCode, accountNumber }) => {
    const r = await client.query(
      `SELECT ${OVERRIDE_COLS} FROM simulator_overrides
        WHERE participant_code = $1 AND account_number = $2 LIMIT 1`,
      [participantCode, accountNumber]
    );
    return r.rows[0] || null;
  },

  listOverrides: async (client, { participantCode } = {}) => {
    if (participantCode) {
      const r = await client.query(
        `SELECT ${OVERRIDE_COLS} FROM simulator_overrides WHERE participant_code = $1`,
        [participantCode]
      );
      return r.rows;
    }
    const r = await client.query(`SELECT ${OVERRIDE_COLS} FROM simulator_overrides`);
    return r.rows;
  }
});
