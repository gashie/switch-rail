ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS retry_policy_name TEXT;

CREATE INDEX IF NOT EXISTS transactions_recovery_due_idx
  ON transactions(next_attempt_at)
  WHERE state = 'PENDING_RECONCILIATION';
