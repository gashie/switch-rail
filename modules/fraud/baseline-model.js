// Account baselines — strictly-derived view of a participant account's
// transaction behavior. Pure SQL aggregates; no business logic in this file.

const BASELINE_COLS = `id, participant_code, account_id, currency, computed_at,
  observation_window_days, median_minor, p90_minor, p99_minor, max_observed_minor,
  daily_count_median, daily_count_p90, business_hours_pct, weekend_pct, night_pct,
  distinct_beneficiaries, beneficiary_repeat_rate, total_observations, metadata`;

export const createBaselineModel = () => ({
  upsert: async (
    client,
    {
      id,
      participantCode,
      accountId,
      currency,
      computedAt,
      observationWindowDays,
      medianMinor,
      p90Minor,
      p99Minor,
      maxObservedMinor,
      dailyCountMedian,
      dailyCountP90,
      businessHoursPct,
      weekendPct,
      nightPct,
      distinctBeneficiaries,
      beneficiaryRepeatRate,
      totalObservations,
      metadata
    }
  ) => {
    const r = await client.query(
      `INSERT INTO account_baselines
         (id, participant_code, account_id, currency, computed_at,
          observation_window_days, median_minor, p90_minor, p99_minor, max_observed_minor,
          daily_count_median, daily_count_p90, business_hours_pct, weekend_pct, night_pct,
          distinct_beneficiaries, beneficiary_repeat_rate, total_observations, metadata)
       VALUES ($1, $2, $3, $4, $5,
               $6, $7, $8, $9, $10,
               $11, $12, $13, $14, $15,
               $16, $17, $18, $19::jsonb)
       ON CONFLICT (account_id, currency) DO UPDATE SET
         participant_code = EXCLUDED.participant_code,
         computed_at = EXCLUDED.computed_at,
         observation_window_days = EXCLUDED.observation_window_days,
         median_minor = EXCLUDED.median_minor,
         p90_minor = EXCLUDED.p90_minor,
         p99_minor = EXCLUDED.p99_minor,
         max_observed_minor = EXCLUDED.max_observed_minor,
         daily_count_median = EXCLUDED.daily_count_median,
         daily_count_p90 = EXCLUDED.daily_count_p90,
         business_hours_pct = EXCLUDED.business_hours_pct,
         weekend_pct = EXCLUDED.weekend_pct,
         night_pct = EXCLUDED.night_pct,
         distinct_beneficiaries = EXCLUDED.distinct_beneficiaries,
         beneficiary_repeat_rate = EXCLUDED.beneficiary_repeat_rate,
         total_observations = EXCLUDED.total_observations,
         metadata = EXCLUDED.metadata
       RETURNING ${BASELINE_COLS}`,
      [
        id,
        participantCode,
        accountId,
        currency,
        computedAt,
        observationWindowDays,
        medianMinor != null ? String(medianMinor) : null,
        p90Minor != null ? String(p90Minor) : null,
        p99Minor != null ? String(p99Minor) : null,
        maxObservedMinor != null ? String(maxObservedMinor) : null,
        dailyCountMedian ?? null,
        dailyCountP90 ?? null,
        businessHoursPct ?? null,
        weekendPct ?? null,
        nightPct ?? null,
        distinctBeneficiaries ?? null,
        beneficiaryRepeatRate ?? null,
        totalObservations ?? 0,
        JSON.stringify(metadata || {})
      ]
    );
    return r.rows[0];
  },

  findByAccountCurrency: async (client, accountId, currency) => {
    const r = await client.query(
      `SELECT ${BASELINE_COLS} FROM account_baselines
        WHERE account_id = $1 AND currency = $2 LIMIT 1`,
      [accountId, currency]
    );
    return r.rows[0] || null;
  },

  listForParticipant: async (client, participantCode) => {
    const r = await client.query(
      `SELECT ${BASELINE_COLS} FROM account_baselines
        WHERE participant_code = $1
        ORDER BY computed_at DESC`,
      [participantCode]
    );
    return r.rows;
  },

  // Aggregate query for one (participant, account, currency) over the
  // given window. Computes percentiles and temporal buckets in one
  // round-trip using PostgreSQL's percentile_cont and FILTER clauses.
  // Returns digit-strings; service wraps in BigInt where needed.
  computeAggregates: async (
    client,
    { participantCode, accountId, accountNumber, currency, windowDays, timezone = 'UTC' }
  ) => {
    void timezone; // local-hour buckets done in JS for now (UTC).
    const r = await client.query(
      `WITH src AS (
         SELECT amount_value, beneficiary_participant, beneficiary_account, created_at
           FROM transactions
          WHERE originator_participant = $1
            AND originator_account = $2
            AND amount_currency = $3
            AND created_at >= now() - ($4 || ' days')::interval
            AND state IN ('CONFIRMED', 'REVERSED', 'PENDING_RECONCILIATION')
       )
       SELECT
         (SELECT count(*) FROM src)::int AS total,
         (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY amount_value)::numeric(38,0) FROM src) AS p50,
         (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY amount_value)::numeric(38,0) FROM src) AS p90,
         (SELECT percentile_cont(0.99) WITHIN GROUP (ORDER BY amount_value)::numeric(38,0) FROM src) AS p99,
         (SELECT max(amount_value) FROM src)::text AS amax,
         (SELECT count(*) FILTER (WHERE EXTRACT(hour FROM created_at) BETWEEN 8 AND 17) FROM src)::int AS biz,
         (SELECT count(*) FILTER (WHERE EXTRACT(dow FROM created_at) IN (0, 6)) FROM src)::int AS wkn,
         (SELECT count(*) FILTER (WHERE EXTRACT(hour FROM created_at) >= 22 OR EXTRACT(hour FROM created_at) < 6) FROM src)::int AS ngt,
         (SELECT count(DISTINCT (beneficiary_participant || ':' || beneficiary_account)) FROM src)::int AS distinct_b
      `,
      [participantCode, accountNumber, currency, String(windowDays)]
    );
    const row = r.rows[0] || {};
    // daily counts: another round-trip but cheap — group by day
    const byDay = await client.query(
      `SELECT count(*)::int AS n FROM transactions
        WHERE originator_participant = $1
          AND originator_account = $2
          AND amount_currency = $3
          AND created_at >= now() - ($4 || ' days')::interval
          AND state IN ('CONFIRMED', 'REVERSED', 'PENDING_RECONCILIATION')
        GROUP BY date_trunc('day', created_at)`,
      [participantCode, accountNumber, currency, String(windowDays)]
    );
    const dailyCounts = byDay.rows.map((d) => d.n).sort((a, b) => a - b);
    const pct = (arr, p) => {
      if (!arr.length) return null;
      const idx = Math.min(arr.length - 1, Math.floor((p / 100) * arr.length));
      return arr[idx];
    };
    void accountId;
    return {
      total: row.total ?? 0,
      medianMinor: row.p50 != null ? String(row.p50) : null,
      p90Minor: row.p90 != null ? String(row.p90) : null,
      p99Minor: row.p99 != null ? String(row.p99) : null,
      maxObservedMinor: row.amax ?? null,
      businessHoursCount: row.biz ?? 0,
      weekendCount: row.wkn ?? 0,
      nightCount: row.ngt ?? 0,
      distinctBeneficiaries: row.distinct_b ?? 0,
      dailyCountMedian: pct(dailyCounts, 50),
      dailyCountP90: pct(dailyCounts, 90)
    };
  },

  // Pull accounts that had at least one transaction in the last `staleSinceHours`
  // hours — these are the ones whose baselines are due for refresh.
  findStaleAccounts: async (client, { staleSinceHours = 24, limit = 1000 }) => {
    const r = await client.query(
      `SELECT DISTINCT t.originator_participant, t.originator_account, t.amount_currency
         FROM transactions t
        WHERE t.created_at >= now() - ($1 || ' hours')::interval
          AND t.state IN ('CONFIRMED', 'REVERSED', 'PENDING_RECONCILIATION')
        LIMIT $2`,
      [String(staleSinceHours), limit]
    );
    return r.rows.map((row) => ({
      participantCode: row.originator_participant,
      accountNumber: row.originator_account,
      currency: row.amount_currency
    }));
  }
});
