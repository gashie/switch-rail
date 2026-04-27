CREATE TABLE IF NOT EXISTS fee_schedules (
  id                  UUID PRIMARY KEY,
  schedule_code       TEXT UNIQUE NOT NULL,
  rail_class          TEXT NOT NULL,
  currency            CHAR(3) NOT NULL,
  fee_type            TEXT NOT NULL,
  flat_minor          NUMERIC(38,0),
  pct_bps             INT,
  tiers               JSONB,
  min_fee_minor       NUMERIC(38,0) NOT NULL DEFAULT 0,
  max_fee_minor       NUMERIC(38,0),
  bearer              TEXT NOT NULL DEFAULT 'DEBT',
  effective_from      TIMESTAMPTZ NOT NULL,
  effective_to        TIMESTAMPTZ,
  active              BOOLEAN NOT NULL DEFAULT true,
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (fee_type = 'FLAT' AND flat_minor IS NOT NULL) OR
    (fee_type = 'PERCENTAGE' AND pct_bps IS NOT NULL) OR
    (fee_type = 'TIERED' AND tiers IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS fee_schedules_active_idx ON fee_schedules(active, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS fee_schedules_class_idx ON fee_schedules(rail_class, currency);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS fee_minor NUMERIC(38,0) NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS fee_schedule_id UUID REFERENCES fee_schedules(id);
