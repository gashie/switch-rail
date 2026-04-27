const LIMIT_COLS = `id, participant_code, currency, prefunded_minor, floor_minor,
  ceiling_minor, throttle_threshold_pct, updated_at`;

const TOPUP_COLS = `id, participant_code, currency, amount_minor, reason,
  applied_by, applied_at, journal_id`;

export const createLiquidityModel = () => ({
  upsertLimits: async (
    client,
    {
      id,
      participantCode,
      currency,
      prefundedMinor,
      floorMinor,
      ceilingMinor,
      throttleThresholdPct
    }
  ) => {
    const r = await client.query(
      `INSERT INTO liquidity_limits
         (id, participant_code, currency, prefunded_minor, floor_minor, ceiling_minor, throttle_threshold_pct)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (participant_code, currency) DO UPDATE
         SET prefunded_minor = EXCLUDED.prefunded_minor,
             floor_minor = EXCLUDED.floor_minor,
             ceiling_minor = EXCLUDED.ceiling_minor,
             throttle_threshold_pct = EXCLUDED.throttle_threshold_pct,
             updated_at = now()
       RETURNING ${LIMIT_COLS}`,
      [
        id,
        participantCode,
        currency,
        String(prefundedMinor),
        String(floorMinor),
        String(ceilingMinor),
        throttleThresholdPct
      ]
    );
    return r.rows[0];
  },

  findLimits: async (client, participantCode, currency) => {
    const r = await client.query(
      `SELECT ${LIMIT_COLS} FROM liquidity_limits
        WHERE participant_code = $1 AND currency = $2 LIMIT 1`,
      [participantCode, currency]
    );
    return r.rows[0] || null;
  },

  listLimits: async (client, { currency }) => {
    if (currency) {
      const r = await client.query(
        `SELECT ${LIMIT_COLS} FROM liquidity_limits
          WHERE currency = $1 ORDER BY participant_code ASC`,
        [currency]
      );
      return r.rows;
    }
    const r = await client.query(
      `SELECT ${LIMIT_COLS} FROM liquidity_limits
        ORDER BY participant_code, currency ASC`
    );
    return r.rows;
  },

  insertTopup: async (
    client,
    { id, participantCode, currency, amountMinor, reason, appliedBy, journalId }
  ) => {
    const r = await client.query(
      `INSERT INTO liquidity_topups
         (id, participant_code, currency, amount_minor, reason, applied_by, journal_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${TOPUP_COLS}`,
      [id, participantCode, currency, String(amountMinor), reason, appliedBy ?? null, journalId]
    );
    return r.rows[0];
  },

  listTopups: async (client, { participantCode, currency, limit }) => {
    const conds = [];
    const params = [];
    if (participantCode) {
      params.push(participantCode);
      conds.push(`participant_code = $${params.length}`);
    }
    if (currency) {
      params.push(currency);
      conds.push(`currency = $${params.length}`);
    }
    params.push(limit);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await client.query(
      `SELECT ${TOPUP_COLS} FROM liquidity_topups
        ${where}
        ORDER BY applied_at DESC
        LIMIT $${params.length}`,
      params
    );
    return r.rows;
  }
});
