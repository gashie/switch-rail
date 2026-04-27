// graph_edges SQL. The service composes upserts on confirmed transactions.

const EDGE_COLS = `id, from_account_key, to_account_key, edge_type,
  total_amount_minor, currency, tx_count, first_seen, last_seen, metadata`;

export const createEdgesModel = () => ({
  upsertEdge: async (
    client,
    { id, fromKey, toKey, edgeType, amountMinor, currency, observedAt }
  ) => {
    const r = await client.query(
      `INSERT INTO graph_edges
         (id, from_account_key, to_account_key, edge_type,
          total_amount_minor, currency, tx_count, first_seen, last_seen)
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $7)
       ON CONFLICT (from_account_key, to_account_key, currency) DO UPDATE
         SET total_amount_minor = graph_edges.total_amount_minor + EXCLUDED.total_amount_minor,
             tx_count = graph_edges.tx_count + 1,
             last_seen = EXCLUDED.last_seen
       RETURNING ${EDGE_COLS}`,
      [id, fromKey, toKey, edgeType, String(amountMinor), currency, observedAt]
    );
    return r.rows[0];
  },

  outgoingFrom: async (client, accountKey, { sinceHours = 24 } = {}) => {
    const r = await client.query(
      `SELECT ${EDGE_COLS} FROM graph_edges
        WHERE from_account_key = $1
          AND last_seen >= now() - ($2 || ' hours')::interval
        ORDER BY last_seen DESC`,
      [accountKey, String(sinceHours)]
    );
    return r.rows;
  },

  incomingTo: async (client, accountKey, { sinceHours = 24 } = {}) => {
    const r = await client.query(
      `SELECT ${EDGE_COLS} FROM graph_edges
        WHERE to_account_key = $1
          AND last_seen >= now() - ($2 || ' hours')::interval
        ORDER BY last_seen DESC`,
      [accountKey, String(sinceHours)]
    );
    return r.rows;
  },

  // Accounts that received >= N inbound transactions in the last
  // windowHours — entry points for the mule-ring DFS.
  hotInboundAccounts: async (client, { windowHours = 24, minInbound = 5 }) => {
    const r = await client.query(
      `SELECT to_account_key
         FROM graph_edges
        WHERE last_seen >= now() - ($1 || ' hours')::interval
        GROUP BY to_account_key
        HAVING SUM(tx_count) >= $2
        ORDER BY SUM(tx_count) DESC
        LIMIT 200`,
      [String(windowHours), minInbound]
    );
    return r.rows.map((row) => row.to_account_key);
  },

  edgesByCurrencyForRecentWindow: async (client, { windowHours = 24, currency }) => {
    const r = await client.query(
      `SELECT ${EDGE_COLS} FROM graph_edges
        WHERE currency = $1
          AND last_seen >= now() - ($2 || ' hours')::interval`,
      [currency, String(windowHours)]
    );
    return r.rows;
  },

  // Per-account outbound aggregate over the structuring window. Used by
  // the structuring scanner: cumulative outbound exceeds threshold but
  // every individual transaction is sub-threshold.
  outboundCumulativeOver: async (
    client,
    { windowHours = 24, cumulativeMinThresholdMinor, individualMaxThresholdMinor }
  ) => {
    const r = await client.query(
      `SELECT t.originator_participant || ':' || t.originator_account AS from_key,
              t.amount_currency AS currency,
              count(*)::int AS tx_count,
              SUM(t.amount_value)::text AS sum_minor,
              count(DISTINCT (t.beneficiary_participant || ':' || t.beneficiary_account))::int AS distinct_bene
         FROM transactions t
        WHERE t.created_at >= now() - ($1 || ' hours')::interval
          AND t.state IN ('CONFIRMED', 'PENDING_RECONCILIATION')
          AND t.amount_value < $3::numeric
        GROUP BY 1, 2
        HAVING SUM(t.amount_value) >= $2::numeric
           AND count(DISTINCT (t.beneficiary_participant || ':' || t.beneficiary_account)) >= 3`,
      [String(windowHours), String(cumulativeMinThresholdMinor), String(individualMaxThresholdMinor)]
    );
    return r.rows;
  },

  // Coordinated burst: many distinct senders pointing at the same
  // beneficiary in a short window.
  coordinatedBurst: async (
    client,
    { windowMinutes = 30, minSenders = 5 }
  ) => {
    const r = await client.query(
      `SELECT t.beneficiary_participant || ':' || t.beneficiary_account AS to_key,
              t.amount_currency AS currency,
              count(*)::int AS tx_count,
              SUM(t.amount_value)::text AS sum_minor,
              count(DISTINCT (t.originator_participant || ':' || t.originator_account))::int AS distinct_senders
         FROM transactions t
        WHERE t.created_at >= now() - ($1 || ' minutes')::interval
          AND t.state IN ('CONFIRMED', 'PENDING_RECONCILIATION')
        GROUP BY 1, 2
        HAVING count(DISTINCT (t.originator_participant || ':' || t.originator_account)) >= $2`,
      [String(windowMinutes), minSenders]
    );
    return r.rows;
  },

  countByFromKey: async (client, accountKey, { sinceHours = 24 } = {}) => {
    const r = await client.query(
      `SELECT count(*)::int AS n FROM graph_edges
        WHERE from_account_key = $1
          AND last_seen >= now() - ($2 || ' hours')::interval`,
      [accountKey, String(sinceHours)]
    );
    return r.rows[0]?.n ?? 0;
  }
});
