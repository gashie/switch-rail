CREATE TABLE IF NOT EXISTS bulk_batches (
  batch_id                UUID PRIMARY KEY,
  source_format           TEXT NOT NULL,
  originator_participant  TEXT,
  total                   INTEGER NOT NULL,
  succeeded               INTEGER NOT NULL,
  failed                  INTEGER NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'completed',
  failures                JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS bulk_batches_created_idx ON bulk_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS bulk_batches_originator_idx ON bulk_batches(originator_participant);
