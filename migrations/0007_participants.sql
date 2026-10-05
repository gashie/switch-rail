CREATE TABLE IF NOT EXISTS participants (
  id                    UUID PRIMARY KEY,
  code                  TEXT UNIQUE NOT NULL,
  name                  TEXT NOT NULL,
  legal_name            TEXT NOT NULL,
  type                  TEXT NOT NULL,
  bic                   TEXT,
  country_code          CHAR(2) NOT NULL DEFAULT 'GH',
  status                TEXT NOT NULL DEFAULT 'pending',
  supported_formats     TEXT[] NOT NULL DEFAULT '{}',
  endpoints             JSONB NOT NULL DEFAULT '{}'::jsonb,
  contact_email         CITEXT,
  contact_phone         TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  certified_at          TIMESTAMPTZ,
  activated_at          TIMESTAMPTZ,
  suspended_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS participants_status_idx ON participants(status);
CREATE INDEX IF NOT EXISTS participants_type_idx ON participants(type);
CREATE INDEX IF NOT EXISTS participants_bic_idx ON participants(bic) WHERE bic IS NOT NULL;
