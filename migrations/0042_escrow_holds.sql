CREATE TABLE IF NOT EXISTS escrow_holds (
  id                       UUID PRIMARY KEY,
  escrow_number            TEXT UNIQUE NOT NULL,
  payer_participant        TEXT NOT NULL REFERENCES participants(code),
  payer_account_id         UUID NOT NULL REFERENCES accounts(id),
  payee_participant        TEXT NOT NULL REFERENCES participants(code),
  payee_account_id         UUID NOT NULL REFERENCES accounts(id),
  amount_minor             NUMERIC(38,0) NOT NULL,
  currency                 CHAR(3) NOT NULL,
  release_condition        TEXT NOT NULL,
  release_at               TIMESTAMPTZ,
  arbiter_user_id          UUID REFERENCES users(id),
  state                    TEXT NOT NULL DEFAULT 'INITIATED',
  hold_transaction_id      UUID REFERENCES transactions(id),
  release_transaction_id   UUID REFERENCES transactions(id),
  payer_signed_at          TIMESTAMPTZ,
  payee_signed_at          TIMESTAMPTZ,
  released_at              TIMESTAMPTZ,
  refunded_at              TIMESTAMPTZ,
  reason                   TEXT,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS escrow_state_idx ON escrow_holds(state);
CREATE INDEX IF NOT EXISTS escrow_release_due_idx ON escrow_holds(release_at)
  WHERE state = 'HELD' AND release_condition = 'TIME_ELAPSED';

CREATE TABLE IF NOT EXISTS escrow_sequence (
  bucket   TEXT PRIMARY KEY,
  seq      BIGINT NOT NULL DEFAULT 0
);
