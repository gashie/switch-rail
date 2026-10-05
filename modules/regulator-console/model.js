export const createRegulatorConsoleModel = () => ({
  // Cross-table read aggregating numbers a regulator wants once a day:
  // tx volume + value, settlement totals, fraud counts, dispute counts,
  // audit-chain root for the day.
  dailyDigest: async (client, { day }) => {
    const txVolume = await client.query(
      `SELECT
         COUNT(*)                                                AS tx_total,
         COUNT(*) FILTER (WHERE state = 'CONFIRMED')             AS tx_confirmed,
         COUNT(*) FILTER (WHERE state = 'REJECTED')              AS tx_rejected,
         COALESCE(SUM(amount_value::numeric)
           FILTER (WHERE state = 'CONFIRMED'), 0)                AS confirmed_value
       FROM transactions
       WHERE operating_date = $1`,
      [day]
    );
    const fraud = await client.query(
      `SELECT
         COUNT(*)                                          AS opened,
         COUNT(*) FILTER (WHERE state = 'CONFIRMED')        AS confirmed
       FROM fraud_cases
       WHERE detected_at::date = $1`,
      [day]
    ).catch(() => ({ rows: [{ opened: 0, confirmed: 0 }] }));
    const disputes = await client.query(
      `SELECT
         COUNT(*) AS opened,
         COUNT(*) FILTER (WHERE state IN ('UPHELD', 'PARTIAL_UPHELD')) AS upheld
       FROM dispute_cases
       WHERE filed_at::date = $1`,
      [day]
    ).catch(() => ({ rows: [{ opened: 0, upheld: 0 }] }));
    const auditRoot = await client.query(
      `SELECT day_root, event_count, frozen_at FROM audit_daily_chain
        WHERE day = $1::date`,
      [day]
    ).catch(() => ({ rows: [] }));
    return {
      day,
      transactions: {
        total: Number(txVolume.rows[0].tx_total),
        confirmed: Number(txVolume.rows[0].tx_confirmed),
        rejected: Number(txVolume.rows[0].tx_rejected),
        confirmedValue: String(txVolume.rows[0].confirmed_value)
      },
      fraud: {
        opened: Number(fraud.rows[0].opened),
        confirmed: Number(fraud.rows[0].confirmed)
      },
      disputes: {
        opened: Number(disputes.rows[0].opened),
        upheld: Number(disputes.rows[0].upheld)
      },
      auditChain: auditRoot.rows[0] || null
    };
  },

  listExports: async (client, { limit = 100 }) => {
    const r = await client.query(
      `SELECT id, requested_by, reason, resource_type, filters, requested_at, file_uri
         FROM regulator_export_log
        ORDER BY requested_at DESC
        LIMIT $1`,
      [limit]
    ).catch(() => ({ rows: [] }));
    return r.rows;
  }
});
