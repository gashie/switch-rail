CREATE TABLE IF NOT EXISTS account_baselines (
  id                       UUID PRIMARY KEY,
  participant_code         TEXT NOT NULL,
  account_id               UUID NOT NULL REFERENCES accounts(id),
  currency                 CHAR(3) NOT NULL,
  computed_at              TIMESTAMPTZ NOT NULL,
  observation_window_days  INT NOT NULL,
  median_minor             NUMERIC(38,0),
  p90_minor                NUMERIC(38,0),
  p99_minor                NUMERIC(38,0),
  max_observed_minor       NUMERIC(38,0),
  daily_count_median       INT,
  daily_count_p90          INT,
  business_hours_pct       INT,
  weekend_pct              INT,
  night_pct                INT,
  distinct_beneficiaries   INT,
  beneficiary_repeat_rate  INT,
  total_observations       INT,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (account_id, currency)
);

CREATE INDEX IF NOT EXISTS baselines_participant_idx ON account_baselines(participant_code);
