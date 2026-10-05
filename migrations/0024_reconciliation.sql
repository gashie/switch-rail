CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id                  UUID PRIMARY KEY,
  participant_code    TEXT NOT NULL REFERENCES participants(code),
  currency            CHAR(3) NOT NULL,
  operating_date      DATE NOT NULL,
  run_type            TEXT NOT NULL,
  state               TEXT NOT NULL DEFAULT 'pending',
  total_compared      INT NOT NULL DEFAULT 0,
  total_matched       INT NOT NULL DEFAULT 0,
  total_breaks        INT NOT NULL DEFAULT 0,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS reconciliation_breaks (
  id                  UUID PRIMARY KEY,
  run_id              UUID NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  break_type          TEXT NOT NULL,
  rail_transaction_id UUID,
  participant_ref     TEXT,
  amount_minor        NUMERIC(38,0),
  currency            CHAR(3),
  rail_state          TEXT,
  participant_state   TEXT,
  resolution          TEXT NOT NULL DEFAULT 'pending',
  resolved_at         TIMESTAMPTZ,
  resolved_by         UUID,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recon_breaks_run_idx ON reconciliation_breaks(run_id);
CREATE INDEX IF NOT EXISTS recon_breaks_unresolved_idx ON reconciliation_breaks(resolution) WHERE resolution = 'pending';
