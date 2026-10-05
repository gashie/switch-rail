CREATE TABLE IF NOT EXISTS envelopes (
  envelope_id              UUID PRIMARY KEY,
  msg_version              TEXT NOT NULL,
  msg_type                 TEXT NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_format            TEXT NOT NULL,
  source_message_id        TEXT,
  end_to_end_id            TEXT NOT NULL,
  idempotency_key          TEXT NOT NULL,
  originator_participant   TEXT NOT NULL,
  originator_account       TEXT NOT NULL,
  originator_country       TEXT,
  beneficiary_participant  TEXT NOT NULL,
  beneficiary_account      TEXT NOT NULL,
  beneficiary_country      TEXT,
  amount_value             NUMERIC(38,0) NOT NULL,
  amount_currency          CHAR(3) NOT NULL,
  fee_value                NUMERIC(38,0),
  fee_currency             CHAR(3),
  fee_bearer               TEXT,
  reference                TEXT,
  remittance               TEXT,
  purpose_code             TEXT,
  settlement_method        TEXT,
  settlement_date          DATE,
  envelope                 JSONB NOT NULL,
  signature                JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS envelopes_idempotency_uniq
  ON envelopes (originator_participant, idempotency_key);

CREATE INDEX IF NOT EXISTS envelopes_created_idx ON envelopes(created_at DESC);
CREATE INDEX IF NOT EXISTS envelopes_originator_idx ON envelopes(originator_participant);
CREATE INDEX IF NOT EXISTS envelopes_beneficiary_idx ON envelopes(beneficiary_participant);
