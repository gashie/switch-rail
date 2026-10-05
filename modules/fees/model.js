const SCHEDULE_COLS = `id, schedule_code, rail_class, currency, fee_type,
  flat_minor, pct_bps, tiers, min_fee_minor, max_fee_minor, bearer,
  effective_from, effective_to, active, created_by, created_at`;

export const createFeesModel = () => ({
  insertSchedule: async (
    client,
    {
      id,
      scheduleCode,
      railClass,
      currency,
      feeType,
      flatMinor,
      pctBps,
      tiers,
      minFeeMinor,
      maxFeeMinor,
      bearer,
      effectiveFrom,
      createdBy
    }
  ) => {
    const r = await client.query(
      `INSERT INTO fee_schedules
         (id, schedule_code, rail_class, currency, fee_type,
          flat_minor, pct_bps, tiers, min_fee_minor, max_fee_minor,
          bearer, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5,
               $6, $7, $8::jsonb, $9, $10,
               $11, $12, $13)
       RETURNING ${SCHEDULE_COLS}`,
      [
        id,
        scheduleCode,
        railClass,
        currency,
        feeType,
        flatMinor != null ? String(flatMinor) : null,
        pctBps ?? null,
        tiers ? JSON.stringify(tiers) : null,
        String(minFeeMinor ?? 0),
        maxFeeMinor != null ? String(maxFeeMinor) : null,
        bearer,
        effectiveFrom,
        createdBy ?? null
      ]
    );
    return r.rows[0];
  },

  // Atomic schedule rollover: mark every active schedule for the same
  // (railClass, currency) inactive with effective_to = now() so the new
  // schedule is the unambiguous winner.
  expireExistingSchedules: async (client, { railClass, currency }) => {
    await client.query(
      `UPDATE fee_schedules
          SET active = false,
              effective_to = COALESCE(effective_to, now())
        WHERE rail_class = $1 AND currency = $2 AND active = true`,
      [railClass, currency]
    );
  },

  findActiveSchedule: async (client, { railClass, currency, asOf }) => {
    const r = await client.query(
      `SELECT ${SCHEDULE_COLS} FROM fee_schedules
        WHERE rail_class = $1
          AND currency = $2
          AND active = true
          AND effective_from <= $3::timestamptz
          AND (effective_to IS NULL OR effective_to >= $3::timestamptz)
        ORDER BY effective_from DESC
        LIMIT 1`,
      [railClass, currency, asOf || new Date().toISOString()]
    );
    return r.rows[0] || null;
  },

  findByCode: async (client, scheduleCode) => {
    const r = await client.query(
      `SELECT ${SCHEDULE_COLS} FROM fee_schedules WHERE schedule_code = $1 LIMIT 1`,
      [scheduleCode]
    );
    return r.rows[0] || null;
  },

  listSchedules: async (client, { railClass, currency, active }) => {
    const conds = [];
    const params = [];
    if (railClass) {
      params.push(railClass);
      conds.push(`rail_class = $${params.length}`);
    }
    if (currency) {
      params.push(currency);
      conds.push(`currency = $${params.length}`);
    }
    if (active != null) {
      params.push(active);
      conds.push(`active = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await client.query(
      `SELECT ${SCHEDULE_COLS} FROM fee_schedules ${where}
        ORDER BY rail_class, currency, effective_from DESC`,
      params
    );
    return r.rows;
  },

  // Fee summary per participant for a date range. Returns the total fee
  // accrued across transactions whose originator/beneficiary matches.
  feeSummaryForRange: async (client, { participantCode, since, until }) => {
    const r = await client.query(
      `SELECT originator_participant AS participant_code,
              amount_currency AS currency,
              COUNT(*)::int AS tx_count,
              COALESCE(SUM(fee_minor), 0)::text AS total_fee_minor
         FROM transactions
        WHERE originator_participant = $1
          AND created_at >= $2::timestamptz
          AND created_at < $3::timestamptz
          AND state IN ('CONFIRMED', 'REVERSED')
        GROUP BY originator_participant, amount_currency
        ORDER BY currency`,
      [participantCode, since, until]
    );
    return r.rows;
  }
});
