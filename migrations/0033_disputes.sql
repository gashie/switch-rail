CREATE TABLE IF NOT EXISTS dispute_cases (
  id                       UUID PRIMARY KEY,
  case_number              TEXT UNIQUE NOT NULL,
  transaction_id           UUID NOT NULL REFERENCES transactions(id),
  reason_code              TEXT NOT NULL,
  filing_participant       TEXT NOT NULL REFERENCES participants(code),
  filing_user_ref          TEXT,
  verification_fingerprint TEXT,
  amount_minor             NUMERIC(38,0) NOT NULL,
  currency                 CHAR(3) NOT NULL,
  state                    TEXT NOT NULL DEFAULT 'FILED',
  filed_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at              TIMESTAMPTZ,
  evidence_pending_until   TIMESTAMPTZ,
  adjudicating_at          TIMESTAMPTZ,
  resolved_at              TIMESTAMPTZ,
  outcome                  TEXT,
  outcome_amount_minor     NUMERIC(38,0),
  outcome_notes            TEXT,
  reserve_journal_id       UUID REFERENCES ledger_journal(id),
  release_journal_id       UUID REFERENCES ledger_journal(id),
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dispute_cases_tx_idx ON dispute_cases(transaction_id);
CREATE INDEX IF NOT EXISTS dispute_cases_state_idx ON dispute_cases(state);
CREATE INDEX IF NOT EXISTS dispute_cases_reason_idx ON dispute_cases(reason_code);
CREATE INDEX IF NOT EXISTS dispute_cases_filing_idx ON dispute_cases(filing_participant);
CREATE INDEX IF NOT EXISTS dispute_cases_pending_evidence_idx ON dispute_cases(state, evidence_pending_until)
  WHERE state = 'EVIDENCE_PENDING';

CREATE TABLE IF NOT EXISTS dispute_status_history (
  id                  UUID PRIMARY KEY,
  case_id             UUID NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
  from_state          TEXT,
  to_state            TEXT NOT NULL,
  reason              TEXT,
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurred_by         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS dispute_history_case_idx ON dispute_status_history(case_id);

-- Per-month case-number sequence. Single row per YYYYMM bucket; row-locked
-- on increment so concurrent filings get monotonically increasing seq.
CREATE TABLE IF NOT EXISTS dispute_case_sequence (
  bucket   TEXT PRIMARY KEY,
  seq      BIGINT NOT NULL DEFAULT 0
);
