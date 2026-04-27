CREATE TABLE IF NOT EXISTS settlement_positions (
  id                  UUID PRIMARY KEY,
  participant_code    TEXT NOT NULL REFERENCES participants(code) ON DELETE RESTRICT,
  currency            CHAR(3) NOT NULL,
  position_minor      NUMERIC(38,0) NOT NULL DEFAULT 0,
  last_journal_id     UUID,
  last_cycle_id       UUID,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participant_code, currency)
);

CREATE INDEX IF NOT EXISTS settlement_positions_currency_idx ON settlement_positions(currency);
