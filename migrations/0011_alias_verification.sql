CREATE TABLE IF NOT EXISTS alias_verification_challenges (
  id                  UUID PRIMARY KEY,
  alias_id            UUID NOT NULL REFERENCES aliases(id) ON DELETE CASCADE,
  method              TEXT NOT NULL,
  challenge_secret    TEXT NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  attempts            INT NOT NULL DEFAULT 0,
  consumed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alias_verif_alias_idx ON alias_verification_challenges(alias_id);
CREATE INDEX IF NOT EXISTS alias_verif_expires_idx ON alias_verification_challenges(expires_at);
