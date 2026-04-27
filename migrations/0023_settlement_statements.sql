CREATE TABLE IF NOT EXISTS settlement_statements (
  id                       UUID PRIMARY KEY,
  operating_day_id         UUID NOT NULL REFERENCES operating_days(id),
  operating_date           DATE NOT NULL,
  participant_code         TEXT NOT NULL,
  currency                 CHAR(3) NOT NULL,
  opening_position_minor   NUMERIC(38,0) NOT NULL,
  total_credits_minor      NUMERIC(38,0) NOT NULL,
  total_debits_minor       NUMERIC(38,0) NOT NULL,
  total_fees_minor         NUMERIC(38,0) NOT NULL,
  cycle_count              INT NOT NULL,
  net_settled_minor        NUMERIC(38,0) NOT NULL,
  closing_position_minor   NUMERIC(38,0) NOT NULL,
  payload                  JSONB NOT NULL,
  signature_b64            TEXT NOT NULL,
  signature_kid            TEXT NOT NULL,
  signature_alg            TEXT NOT NULL DEFAULT 'Ed25519',
  issued_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (operating_day_id, participant_code, currency)
);

CREATE INDEX IF NOT EXISTS settlement_statements_participant_idx
  ON settlement_statements(participant_code, operating_date DESC);
