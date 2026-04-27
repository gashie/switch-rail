CREATE TABLE IF NOT EXISTS fast_track_reversals (
  id                       UUID PRIMARY KEY,
  original_transaction_id  UUID NOT NULL REFERENCES transactions(id),
  reversal_transaction_id  UUID REFERENCES transactions(id),
  victim_participant       TEXT NOT NULL,
  receiving_participant    TEXT NOT NULL,
  invoked_by               UUID REFERENCES users(id),
  invoked_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence                 JSONB NOT NULL,
  state                    TEXT NOT NULL DEFAULT 'invoked',
  freeze_attempted_at      TIMESTAMPTZ,
  receiving_acknowledged_at TIMESTAMPTZ,
  reason_code              TEXT NOT NULL,
  reason_message           TEXT,
  resolved_at              TIMESTAMPTZ,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ftr_state_idx ON fast_track_reversals(state);
CREATE INDEX IF NOT EXISTS ftr_orig_idx ON fast_track_reversals(original_transaction_id);
CREATE INDEX IF NOT EXISTS ftr_victim_month_idx
  ON fast_track_reversals(victim_participant, invoked_at);
