CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS watchlist_entries (
  id                  UUID PRIMARY KEY,
  source              TEXT NOT NULL,
  list_type           TEXT NOT NULL,
  source_record_id    TEXT,
  primary_name        TEXT NOT NULL,
  primary_name_norm   TEXT NOT NULL,
  aliases             TEXT[] NOT NULL DEFAULT '{}',
  alias_norms         TEXT[] NOT NULL DEFAULT '{}',
  countries           TEXT[],
  date_of_birth       DATE,
  ghanacard_pin       TEXT,
  account_numbers     TEXT[],
  reason              TEXT,
  added_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at          TIMESTAMPTZ,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS wl_active_idx ON watchlist_entries(source, list_type) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS wl_norm_idx ON watchlist_entries USING gin (primary_name_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS wl_alias_norm_idx ON watchlist_entries USING gin (alias_norms);
CREATE INDEX IF NOT EXISTS wl_ghc_idx ON watchlist_entries(ghanacard_pin) WHERE ghanacard_pin IS NOT NULL;
CREATE INDEX IF NOT EXISTS wl_accounts_idx ON watchlist_entries USING gin (account_numbers);

CREATE TABLE IF NOT EXISTS watchlist_screenings (
  id                  UUID PRIMARY KEY,
  transaction_id      UUID REFERENCES transactions(id),
  party               TEXT NOT NULL,
  query_name          TEXT NOT NULL,
  query_account       TEXT,
  hit                 BOOLEAN NOT NULL,
  matches             JSONB NOT NULL DEFAULT '[]'::jsonb,
  screened_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ws_tx_idx ON watchlist_screenings(transaction_id);
CREATE INDEX IF NOT EXISTS ws_hit_idx ON watchlist_screenings(hit) WHERE hit = true;
