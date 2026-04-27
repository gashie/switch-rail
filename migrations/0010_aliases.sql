CREATE TABLE IF NOT EXISTS aliases (
  id                  UUID PRIMARY KEY,
  alias_type          TEXT NOT NULL,
  alias_value         TEXT NOT NULL,
  alias_value_display TEXT NOT NULL,
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  participant_code    TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  verification_method TEXT,
  verified_at         TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Active alias (pending or verified) must be globally unique per (type,value).
CREATE UNIQUE INDEX IF NOT EXISTS aliases_active_uniq
  ON aliases (alias_type, alias_value)
  WHERE status IN ('pending', 'verified');

CREATE INDEX IF NOT EXISTS aliases_account_idx ON aliases(account_id);
CREATE INDEX IF NOT EXISTS aliases_participant_idx ON aliases(participant_code);
CREATE INDEX IF NOT EXISTS aliases_type_idx ON aliases(alias_type);
