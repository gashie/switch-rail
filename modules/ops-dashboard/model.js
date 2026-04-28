const SNAPSHOT_COLS = `id, bucket_minute, metric_kind, rail_class,
  value_numeric, value_count, payload, created_at`;

export const createOpsDashboardModel = () => ({
  insertSnapshot: async (client, { id, bucketMinute, metricKind, railClass, valueNumeric, valueCount, payload }) => {
    const r = await client.query(
      `INSERT INTO ops_metric_snapshots (id, bucket_minute, metric_kind, rail_class, value_numeric, value_count, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${SNAPSHOT_COLS}`,
      [id, bucketMinute, metricKind, railClass || null, valueNumeric, valueCount, payload || {}]
    );
    return r.rows[0];
  },

  listSnapshots: async (client, { metricKind, fromMinute, toMinute, limit }) => {
    const conds = [];
    const params = [];
    if (metricKind) { params.push(metricKind); conds.push(`metric_kind = $${params.length}`); }
    if (fromMinute) { params.push(fromMinute); conds.push(`bucket_minute >= $${params.length}`); }
    if (toMinute)   { params.push(toMinute);   conds.push(`bucket_minute < $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit);
    const r = await client.query(
      `SELECT ${SNAPSHOT_COLS} FROM ops_metric_snapshots ${where}
        ORDER BY bucket_minute DESC LIMIT $${params.length}`,
      params
    );
    return r.rows;
  },

  // Aggregate live counters from existing tables. Read-only roll-ups; the
  // dashboard pulls these without ever mutating source-of-truth state.
  summarize: async (client, { windowMinutes }) => {
    const sinceParam = `${windowMinutes} minutes`;
    const since = await client.query(`SELECT (now() - $1::interval) AS t`, [sinceParam]);
    const sinceTs = since.rows[0].t;
    const tx = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE state = 'CONFIRMED')      AS confirmed,
         COUNT(*) FILTER (WHERE state = 'REJECTED')       AS rejected,
         COUNT(*) FILTER (WHERE state = 'AUTHORIZED')     AS authorized,
         COUNT(*)                                          AS total
       FROM transactions WHERE created_at >= $1`,
      [sinceTs]
    );
    const recon = await client.query(
      `SELECT COUNT(*) AS open_breaks
         FROM reconciliation_breaks
        WHERE state = 'OPEN'`
    ).catch(() => ({ rows: [{ open_breaks: 0 }] }));
    const fraud = await client.query(
      `SELECT COUNT(*) AS open_fraud
         FROM fraud_cases
        WHERE state IN ('OPEN', 'FROZEN')`
    ).catch(() => ({ rows: [{ open_fraud: 0 }] }));
    const incidents = await client.query(
      `SELECT COUNT(*) AS open_incidents
         FROM status_incidents
        WHERE state = 'OPEN'`
    );
    return {
      windowMinutes,
      since: sinceTs,
      transactions: {
        total: Number(tx.rows[0].total),
        confirmed: Number(tx.rows[0].confirmed),
        rejected: Number(tx.rows[0].rejected),
        authorized: Number(tx.rows[0].authorized),
        successRate: Number(tx.rows[0].total) === 0
          ? null
          : Number(tx.rows[0].confirmed) / Number(tx.rows[0].total)
      },
      openReconBreaks: Number(recon.rows[0].open_breaks),
      openFraudCases: Number(fraud.rows[0].open_fraud),
      openIncidents: Number(incidents.rows[0].open_incidents)
    };
  }
});

export const opsDashboardColumns = SNAPSHOT_COLS;
