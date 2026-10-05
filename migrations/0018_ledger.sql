CREATE TABLE IF NOT EXISTS ledger_accounts (
  id                  UUID PRIMARY KEY,
  account_code        TEXT UNIQUE NOT NULL,
  account_type        TEXT NOT NULL,
  owner_type          TEXT NOT NULL,
  owner_id            TEXT,
  currency            CHAR(3) NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active',
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ledger_accounts_owner_idx ON ledger_accounts(owner_type, owner_id, currency);
CREATE INDEX IF NOT EXISTS ledger_accounts_type_idx ON ledger_accounts(account_type);

CREATE TABLE IF NOT EXISTS ledger_journal (
  id                  UUID PRIMARY KEY,
  journal_seq         BIGSERIAL UNIQUE,
  posted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  operating_date      DATE NOT NULL,
  reason              TEXT NOT NULL,
  reference_type      TEXT,
  reference_id        TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash           TEXT NOT NULL,
  hash                TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ledger_journal_date_idx ON ledger_journal(operating_date);
CREATE INDEX IF NOT EXISTS ledger_journal_reason_idx ON ledger_journal(reason);
CREATE INDEX IF NOT EXISTS ledger_journal_ref_idx ON ledger_journal(reference_type, reference_id);

CREATE TABLE IF NOT EXISTS ledger_postings (
  id                  UUID PRIMARY KEY,
  journal_id          UUID NOT NULL REFERENCES ledger_journal(id) ON DELETE RESTRICT,
  posting_seq         INT NOT NULL,
  account_code        TEXT NOT NULL REFERENCES ledger_accounts(account_code),
  side                CHAR(2) NOT NULL,
  amount_value        NUMERIC(38,0) NOT NULL,
  currency            CHAR(3) NOT NULL,
  UNIQUE (journal_id, posting_seq)
);

CREATE INDEX IF NOT EXISTS ledger_postings_account_idx ON ledger_postings(account_code);
CREATE INDEX IF NOT EXISTS ledger_postings_journal_idx ON ledger_postings(journal_id);
