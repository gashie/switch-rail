CREATE TABLE IF NOT EXISTS refunds (
  id                       UUID PRIMARY KEY,
  refund_number            TEXT UNIQUE NOT NULL,
  original_transaction_id  UUID NOT NULL REFERENCES transactions(id),
  refund_transaction_id    UUID REFERENCES transactions(id),
  initiated_by_participant TEXT NOT NULL,
  amount_minor             NUMERIC(38,0) NOT NULL,
  currency                 CHAR(3) NOT NULL,
  reason_code              TEXT NOT NULL,
  reason_message           TEXT,
  state                    TEXT NOT NULL DEFAULT 'INITIATED',
  link_signature_b64       TEXT NOT NULL,
  link_signature_kid       TEXT NOT NULL,
  initiated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS refunds_orig_idx ON refunds(original_transaction_id);
CREATE INDEX IF NOT EXISTS refunds_state_idx ON refunds(state);

CREATE TABLE IF NOT EXISTS refund_sequence (
  bucket   TEXT PRIMARY KEY,
  seq      BIGINT NOT NULL DEFAULT 0
);
