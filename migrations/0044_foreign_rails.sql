CREATE TABLE IF NOT EXISTS foreign_rails (
  id                       UUID PRIMARY KEY,
  rail_code                TEXT UNIQUE NOT NULL,
  rail_name                TEXT NOT NULL,
  rail_type                TEXT NOT NULL,
  participant_id           UUID NOT NULL REFERENCES participants(id),
  supported_currencies     TEXT[] NOT NULL,
  supported_countries      TEXT[] NOT NULL,
  settlement_model         TEXT NOT NULL,
  cutover_time_utc         TIME,
  endpoints                JSONB NOT NULL,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  active                   BOOLEAN NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS foreign_rails_active_idx ON foreign_rails(active);
CREATE INDEX IF NOT EXISTS foreign_rails_country_idx ON foreign_rails USING gin(supported_countries);
CREATE INDEX IF NOT EXISTS foreign_rails_currency_idx ON foreign_rails USING gin(supported_currencies);
