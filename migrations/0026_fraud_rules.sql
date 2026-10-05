CREATE TABLE IF NOT EXISTS fraud_rule_packs (
  id                  UUID PRIMARY KEY,
  pack_code           TEXT UNIQUE NOT NULL,
  name                TEXT NOT NULL,
  description         TEXT,
  block_threshold     INT NOT NULL DEFAULT 80,
  review_threshold    INT NOT NULL DEFAULT 50,
  active              BOOLEAN NOT NULL DEFAULT true,
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fraud_rules (
  id                  UUID PRIMARY KEY,
  rule_code           TEXT UNIQUE NOT NULL,
  pack_id             UUID NOT NULL REFERENCES fraud_rule_packs(id),
  name                TEXT NOT NULL,
  description         TEXT,
  weight              INT NOT NULL DEFAULT 50,
  parameters          JSONB NOT NULL DEFAULT '{}'::jsonb,
  active              BOOLEAN NOT NULL DEFAULT true,
  effective_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to        TIMESTAMPTZ,
  pending_change      JSONB,
  proposed_by         UUID REFERENCES users(id),
  proposed_at         TIMESTAMPTZ,
  approved_by         UUID REFERENCES users(id),
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fraud_rules_pack_idx ON fraud_rules(pack_id);
CREATE INDEX IF NOT EXISTS fraud_rules_active_idx ON fraud_rules(active);

CREATE TABLE IF NOT EXISTS fraud_participant_rule_packs (
  participant_code    TEXT NOT NULL REFERENCES participants(code),
  pack_id             UUID NOT NULL REFERENCES fraud_rule_packs(id),
  enabled             BOOLEAN NOT NULL DEFAULT true,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (participant_code, pack_id)
);

-- Velocity windows in the rule context builder pull aggregates over this
-- compound index. Without it the 1h/6h/24h/7d round-trip blows the 25ms
-- budget for the rules layer.
CREATE INDEX IF NOT EXISTS transactions_originator_time_idx
  ON transactions(originator_participant, originator_account, created_at);

CREATE INDEX IF NOT EXISTS transactions_beneficiary_time_idx
  ON transactions(beneficiary_participant, beneficiary_account, created_at);
