CREATE TABLE IF NOT EXISTS liquidity_limits (
  id                       UUID PRIMARY KEY,
  participant_code         TEXT NOT NULL REFERENCES participants(code) ON DELETE RESTRICT,
  currency                 CHAR(3) NOT NULL,
  prefunded_minor          NUMERIC(38,0) NOT NULL DEFAULT 0,
  floor_minor              NUMERIC(38,0) NOT NULL DEFAULT 0,
  ceiling_minor            NUMERIC(38,0) NOT NULL,
  throttle_threshold_pct   INT NOT NULL DEFAULT 80,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participant_code, currency)
);

CREATE TABLE IF NOT EXISTS liquidity_topups (
  id                  UUID PRIMARY KEY,
  participant_code    TEXT NOT NULL REFERENCES participants(code),
  currency            CHAR(3) NOT NULL,
  amount_minor        NUMERIC(38,0) NOT NULL,
  reason              TEXT NOT NULL,
  applied_by          UUID REFERENCES users(id),
  applied_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  journal_id          UUID NOT NULL REFERENCES ledger_journal(id)
);

CREATE INDEX IF NOT EXISTS liquidity_topups_participant_idx ON liquidity_topups(participant_code, applied_at DESC);
