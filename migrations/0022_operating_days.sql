CREATE TABLE IF NOT EXISTS operating_days (
  id                  UUID PRIMARY KEY,
  operating_date      DATE UNIQUE NOT NULL,
  state               TEXT NOT NULL DEFAULT 'OPEN',
  opened_at           TIMESTAMPTZ NOT NULL,
  cutover_at          TIMESTAMPTZ,
  closed_at           TIMESTAMPTZ,
  closing_journal_seq BIGINT,
  closing_chain_hash  TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS operating_days_state_idx ON operating_days(state);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS operating_date DATE;

UPDATE transactions
   SET operating_date = COALESCE(authorized_at, created_at)::date
 WHERE operating_date IS NULL;

ALTER TABLE transactions ALTER COLUMN operating_date SET NOT NULL;
CREATE INDEX IF NOT EXISTS transactions_operating_date_idx ON transactions(operating_date);
