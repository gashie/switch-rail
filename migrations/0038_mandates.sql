CREATE TABLE IF NOT EXISTS mandates (
  id                       UUID PRIMARY KEY,
  mandate_number           TEXT UNIQUE NOT NULL,
  payer_participant        TEXT NOT NULL REFERENCES participants(code),
  payer_account_id         UUID NOT NULL REFERENCES accounts(id),
  payee_participant        TEXT NOT NULL REFERENCES participants(code),
  payee_account_id         UUID NOT NULL REFERENCES accounts(id),
  per_debit_cap_minor      NUMERIC(38,0) NOT NULL,
  daily_cap_minor          NUMERIC(38,0),
  monthly_cap_minor        NUMERIC(38,0),
  total_cap_minor          NUMERIC(38,0),
  currency                 CHAR(3) NOT NULL,
  frequency                TEXT NOT NULL,
  reference                TEXT,
  description              TEXT,
  state                    TEXT NOT NULL DEFAULT 'ACTIVE',
  authorized_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_from           TIMESTAMPTZ NOT NULL,
  effective_to             TIMESTAMPTZ,
  next_scheduled_at        TIMESTAMPTZ,
  total_debited_minor      NUMERIC(38,0) NOT NULL DEFAULT 0,
  total_debit_count        INT NOT NULL DEFAULT 0,
  last_debited_at          TIMESTAMPTZ,
  revoked_at               TIMESTAMPTZ,
  revoked_by               TEXT,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS mandates_payer_idx ON mandates(payer_participant, state);
CREATE INDEX IF NOT EXISTS mandates_due_idx ON mandates(next_scheduled_at) WHERE state = 'ACTIVE' AND frequency != 'AS_PRESENTED';

CREATE TABLE IF NOT EXISTS mandate_debits (
  id                  UUID PRIMARY KEY,
  mandate_id          UUID NOT NULL REFERENCES mandates(id) ON DELETE RESTRICT,
  transaction_id      UUID REFERENCES transactions(id),
  presented_amount_minor NUMERIC(38,0) NOT NULL,
  result              TEXT NOT NULL,
  result_message      TEXT,
  presented_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mandate_debits_mandate_idx ON mandate_debits(mandate_id);

CREATE TABLE IF NOT EXISTS mandate_sequence (
  bucket   TEXT PRIMARY KEY,
  seq      BIGINT NOT NULL DEFAULT 0
);
