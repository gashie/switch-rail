CREATE TABLE IF NOT EXISTS graph_edges (
  id                  UUID PRIMARY KEY,
  from_account_key    TEXT NOT NULL,
  to_account_key      TEXT NOT NULL,
  edge_type           TEXT NOT NULL,
  total_amount_minor  NUMERIC(38,0) NOT NULL DEFAULT 0,
  currency            CHAR(3) NOT NULL,
  tx_count            INT NOT NULL DEFAULT 0,
  first_seen          TIMESTAMPTZ NOT NULL,
  last_seen           TIMESTAMPTZ NOT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (from_account_key, to_account_key, currency)
);

CREATE INDEX IF NOT EXISTS edges_from_idx ON graph_edges(from_account_key);
CREATE INDEX IF NOT EXISTS edges_to_idx ON graph_edges(to_account_key);
CREATE INDEX IF NOT EXISTS edges_recent_idx ON graph_edges(last_seen DESC);

CREATE TABLE IF NOT EXISTS graph_alerts (
  id                  UUID PRIMARY KEY,
  alert_type          TEXT NOT NULL,
  account_keys        TEXT[] NOT NULL,
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence            JSONB NOT NULL,
  composite_score     INT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'open',
  resolved_by         UUID REFERENCES users(id),
  resolved_at         TIMESTAMPTZ,
  resolution_notes    TEXT
);

CREATE INDEX IF NOT EXISTS alerts_status_idx ON graph_alerts(status);
CREATE INDEX IF NOT EXISTS alerts_type_idx ON graph_alerts(alert_type);
