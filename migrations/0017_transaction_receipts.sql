CREATE TABLE IF NOT EXISTS transaction_receipts (
  id                  UUID PRIMARY KEY,
  transaction_id      UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  party               TEXT NOT NULL,
  participant_code    TEXT NOT NULL,
  receipt_payload     JSONB NOT NULL,
  signature_b64       TEXT NOT NULL,
  signature_kid       TEXT NOT NULL,
  signature_alg       TEXT NOT NULL DEFAULT 'Ed25519',
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, party)
);

CREATE INDEX IF NOT EXISTS receipts_participant_idx ON transaction_receipts(participant_code);
CREATE INDEX IF NOT EXISTS receipts_transaction_idx ON transaction_receipts(transaction_id);
