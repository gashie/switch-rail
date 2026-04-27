CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS accounts (
  id                       UUID PRIMARY KEY,
  participant_id           UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  participant_code         TEXT NOT NULL,
  account_type             TEXT NOT NULL,
  account_number           TEXT NOT NULL,
  account_name             TEXT NOT NULL,
  account_name_normalized  TEXT NOT NULL,
  currency                 CHAR(3) NOT NULL DEFAULT 'GHS',
  status                   TEXT NOT NULL DEFAULT 'active',
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  opened_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at                TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participant_code, account_number)
);

CREATE INDEX IF NOT EXISTS accounts_participant_idx ON accounts(participant_id);
CREATE INDEX IF NOT EXISTS accounts_type_idx ON accounts(account_type);
CREATE INDEX IF NOT EXISTS accounts_status_idx ON accounts(status);
CREATE INDEX IF NOT EXISTS accounts_name_norm_idx ON accounts USING gin (account_name_normalized gin_trgm_ops);
