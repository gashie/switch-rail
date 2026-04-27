CREATE TABLE IF NOT EXISTS dispute_decisions (
  id                   UUID PRIMARY KEY,
  case_id              UUID UNIQUE NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
  decision_type        TEXT NOT NULL,
  outcome              TEXT NOT NULL,
  outcome_amount_minor NUMERIC(38,0),
  rationale_code       TEXT NOT NULL,
  rationale_notes      TEXT,
  decided_by_user      UUID REFERENCES users(id),
  decided_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_considered  JSONB
);

CREATE INDEX IF NOT EXISTS dispute_decisions_case_idx ON dispute_decisions(case_id);
