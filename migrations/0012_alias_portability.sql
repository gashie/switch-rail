CREATE TABLE IF NOT EXISTS alias_portability_requests (
  id                  UUID PRIMARY KEY,
  alias_id            UUID NOT NULL REFERENCES aliases(id) ON DELETE RESTRICT,
  from_participant    TEXT NOT NULL,
  from_account_id     UUID NOT NULL,
  to_participant      TEXT NOT NULL,
  to_account_id       UUID NOT NULL,
  initiated_by        UUID REFERENCES users(id),
  status              TEXT NOT NULL DEFAULT 'pending',
  consent_method      TEXT,
  consent_secret      TEXT,
  consent_expires_at  TIMESTAMPTZ,
  consented_at        TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  rejected_reason     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alias_port_alias_idx ON alias_portability_requests(alias_id);
CREATE INDEX IF NOT EXISTS alias_port_status_idx ON alias_portability_requests(status);
