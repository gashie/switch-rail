CREATE TABLE IF NOT EXISTS transactions (
  id                       UUID PRIMARY KEY,
  envelope_id              UUID NOT NULL REFERENCES envelopes(envelope_id) ON DELETE RESTRICT,
  end_to_end_id            TEXT NOT NULL,
  state                    TEXT NOT NULL,
  rail_class               TEXT NOT NULL,
  originator_participant   TEXT NOT NULL,
  originator_account       TEXT NOT NULL,
  beneficiary_participant  TEXT NOT NULL,
  beneficiary_account      TEXT NOT NULL,
  amount_value             NUMERIC(38,0) NOT NULL,
  amount_currency          CHAR(3) NOT NULL,
  response_code            TEXT,
  reason_code              TEXT,
  reason_message           TEXT,
  authorized_at            TIMESTAMPTZ,
  routed_at                TIMESTAMPTZ,
  credit_leg_started_at    TIMESTAMPTZ,
  confirmed_at             TIMESTAMPTZ,
  rejected_at              TIMESTAMPTZ,
  reversed_at              TIMESTAMPTZ,
  failed_at                TIMESTAMPTZ,
  reversal_transaction_id  UUID REFERENCES transactions(id),
  original_transaction_id  UUID REFERENCES transactions(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS transactions_envelope_uniq ON transactions(envelope_id) WHERE original_transaction_id IS NULL;
CREATE INDEX IF NOT EXISTS transactions_envelope_idx ON transactions(envelope_id);
CREATE INDEX IF NOT EXISTS transactions_state_idx ON transactions(state);
CREATE INDEX IF NOT EXISTS transactions_originator_idx ON transactions(originator_participant);
CREATE INDEX IF NOT EXISTS transactions_beneficiary_idx ON transactions(beneficiary_participant);
CREATE INDEX IF NOT EXISTS transactions_e2e_idx ON transactions(end_to_end_id);
CREATE INDEX IF NOT EXISTS transactions_pending_recon_idx ON transactions(state) WHERE state = 'PENDING_RECONCILIATION';

CREATE TABLE IF NOT EXISTS transaction_status_history (
  id                  UUID PRIMARY KEY,
  transaction_id      UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  from_state          TEXT,
  to_state            TEXT NOT NULL,
  reason_code         TEXT,
  reason_message      TEXT,
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurred_by         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tsh_transaction_idx ON transaction_status_history(transaction_id);
CREATE INDEX IF NOT EXISTS tsh_occurred_idx ON transaction_status_history(occurred_at);
