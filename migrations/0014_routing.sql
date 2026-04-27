CREATE TABLE IF NOT EXISTS routing_rules (
  id                  UUID PRIMARY KEY,
  rule_type           TEXT NOT NULL,
  pattern             TEXT NOT NULL,
  participant_code    TEXT NOT NULL REFERENCES participants(code),
  priority            INT NOT NULL DEFAULT 100,
  active              BOOLEAN NOT NULL DEFAULT true,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rule_type, pattern, participant_code)
);

CREATE INDEX IF NOT EXISTS routing_active_idx ON routing_rules(active, rule_type);
