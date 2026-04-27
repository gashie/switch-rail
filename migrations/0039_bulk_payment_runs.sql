CREATE TABLE IF NOT EXISTS bulk_payment_runs (
  id                       UUID PRIMARY KEY,
  run_number               TEXT UNIQUE NOT NULL,
  originator_participant   TEXT NOT NULL REFERENCES participants(code),
  source_format            TEXT NOT NULL,
  source_filename          TEXT NOT NULL,
  source_sha256            TEXT NOT NULL,
  total_lines              INT NOT NULL,
  total_amount_minor       NUMERIC(38,0) NOT NULL,
  currency                 CHAR(3) NOT NULL,
  state                    TEXT NOT NULL DEFAULT 'QUEUED',
  succeeded_count          INT NOT NULL DEFAULT 0,
  failed_count             INT NOT NULL DEFAULT 0,
  succeeded_amount_minor   NUMERIC(38,0) NOT NULL DEFAULT 0,
  failed_amount_minor      NUMERIC(38,0) NOT NULL DEFAULT 0,
  started_at               TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  uploaded_by_user         UUID REFERENCES users(id),
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS bulk_runs_state_idx ON bulk_payment_runs(state);
CREATE INDEX IF NOT EXISTS bulk_runs_originator_idx ON bulk_payment_runs(originator_participant);
CREATE UNIQUE INDEX IF NOT EXISTS bulk_runs_idem_uniq
  ON bulk_payment_runs (originator_participant, source_sha256);

CREATE TABLE IF NOT EXISTS bulk_payment_lines (
  id                       UUID PRIMARY KEY,
  run_id                   UUID NOT NULL REFERENCES bulk_payment_runs(id) ON DELETE CASCADE,
  line_number              INT NOT NULL,
  envelope_id              UUID REFERENCES envelopes(envelope_id),
  transaction_id           UUID REFERENCES transactions(id),
  state                    TEXT NOT NULL DEFAULT 'PENDING',
  result_code              TEXT,
  result_message           TEXT,
  amount_minor             NUMERIC(38,0) NOT NULL,
  beneficiary_participant  TEXT NOT NULL,
  beneficiary_account      TEXT NOT NULL,
  processed_at             TIMESTAMPTZ,
  UNIQUE (run_id, line_number)
);

CREATE INDEX IF NOT EXISTS bulk_lines_run_idx ON bulk_payment_lines(run_id);
CREATE INDEX IF NOT EXISTS bulk_lines_state_idx ON bulk_payment_lines(state);

CREATE TABLE IF NOT EXISTS bulk_run_sequence (
  bucket   TEXT PRIMARY KEY,
  seq      BIGINT NOT NULL DEFAULT 0
);
