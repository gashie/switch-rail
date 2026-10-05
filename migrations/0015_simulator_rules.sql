CREATE TABLE IF NOT EXISTS simulator_overrides (
  id                  UUID PRIMARY KEY,
  participant_code    TEXT NOT NULL,
  account_number      TEXT NOT NULL,
  behavior            TEXT NOT NULL,
  reason_code         TEXT,
  delay_ms            INT NOT NULL DEFAULT 50,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participant_code, account_number)
);

CREATE INDEX IF NOT EXISTS sim_overrides_lookup_idx ON simulator_overrides(participant_code, account_number);
