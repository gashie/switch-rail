CREATE TABLE IF NOT EXISTS fx_market_makers (
  id                  UUID PRIMARY KEY,
  maker_code          TEXT UNIQUE NOT NULL,
  maker_name          TEXT NOT NULL,
  supported_pairs     TEXT[] NOT NULL,
  endpoints           JSONB NOT NULL,
  priority            INT NOT NULL DEFAULT 100,
  active              BOOLEAN NOT NULL DEFAULT true,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fx_makers_active_idx ON fx_market_makers(active, priority);
CREATE INDEX IF NOT EXISTS fx_makers_pairs_idx ON fx_market_makers USING gin(supported_pairs);

-- The market_maker_id FK on fx_quotes wasn't constrained in migration 0045
-- because the table didn't exist yet. Add it now.
ALTER TABLE fx_quotes
  ADD CONSTRAINT fx_quotes_market_maker_id_fkey
  FOREIGN KEY (market_maker_id) REFERENCES fx_market_makers(id);
