CREATE TABLE IF NOT EXISTS signing_keys (
  id                     UUID PRIMARY KEY,
  owner_type             TEXT NOT NULL,
  owner_id               TEXT,
  kid                    TEXT UNIQUE NOT NULL,
  public_key_pem         TEXT NOT NULL,
  private_key_ciphertext TEXT NOT NULL,
  private_key_iv         TEXT NOT NULL,
  private_key_tag        TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'active',
  activated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at             TIMESTAMPTZ,
  revoked_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS signing_keys_owner_idx ON signing_keys(owner_type, owner_id, status);
