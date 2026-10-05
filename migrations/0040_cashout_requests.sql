CREATE TABLE IF NOT EXISTS cashout_requests (
  id                       UUID PRIMARY KEY,
  request_number           TEXT UNIQUE NOT NULL,
  customer_participant     TEXT NOT NULL REFERENCES participants(code),
  customer_account_id      UUID NOT NULL REFERENCES accounts(id),
  agent_participant        TEXT NOT NULL REFERENCES participants(code),
  agent_float_account_id   UUID NOT NULL REFERENCES accounts(id),
  amount_minor             NUMERIC(38,0) NOT NULL,
  currency                 CHAR(3) NOT NULL,
  state                    TEXT NOT NULL DEFAULT 'INITIATED',
  expires_at               TIMESTAMPTZ NOT NULL,
  authorized_at            TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  cancelled_at             TIMESTAMPTZ,
  transaction_id           UUID REFERENCES transactions(id),
  agent_otp                TEXT,
  agent_otp_expires_at     TIMESTAMPTZ,
  agent_otp_attempts       INT NOT NULL DEFAULT 0,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cashout_state_idx ON cashout_requests(state);
CREATE INDEX IF NOT EXISTS cashout_agent_idx ON cashout_requests(agent_participant);
CREATE INDEX IF NOT EXISTS cashout_expires_idx ON cashout_requests(state, expires_at)
  WHERE state IN ('INITIATED', 'AUTHORIZED');

CREATE TABLE IF NOT EXISTS cashout_request_sequence (
  bucket   TEXT PRIMARY KEY,
  seq      BIGINT NOT NULL DEFAULT 0
);
