CREATE TABLE IF NOT EXISTS transaction_fraud_signals (
  id                  UUID PRIMARY KEY,
  transaction_id      UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  source              TEXT NOT NULL,
  composite_verdict   TEXT NOT NULL,
  composite_score     INT NOT NULL,
  rule_hits           JSONB NOT NULL DEFAULT '[]'::jsonb,
  ml_score            NUMERIC(5,4),
  ml_features         JSONB,
  evaluated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  evaluated_by        TEXT NOT NULL DEFAULT 'in-line'
);

CREATE INDEX IF NOT EXISTS tfs_tx_idx ON transaction_fraud_signals(transaction_id);
CREATE INDEX IF NOT EXISTS tfs_review_idx
  ON transaction_fraud_signals(composite_verdict)
  WHERE composite_verdict IN ('REVIEW', 'BLOCK');
