CREATE TABLE IF NOT EXISTS r2p_requests (
  id                       UUID PRIMARY KEY,
  request_number           TEXT UNIQUE NOT NULL,
  requester_participant    TEXT NOT NULL REFERENCES participants(code),
  requester_account_id     UUID NOT NULL REFERENCES accounts(id),
  payer_participant        TEXT NOT NULL REFERENCES participants(code),
  payer_account_id         UUID,
  payer_alias_type         TEXT,
  payer_alias_value        TEXT,
  amount_minor             NUMERIC(38,0) NOT NULL,
  currency                 CHAR(3) NOT NULL,
  reason                   TEXT,
  reference                TEXT,
  state                    TEXT NOT NULL DEFAULT 'PENDING',
  expires_at               TIMESTAMPTZ NOT NULL,
  authorized_at            TIMESTAMPTZ,
  paid_transaction_id      UUID REFERENCES transactions(id),
  rejected_reason          TEXT,
  idempotency_key          TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS r2p_payer_idx ON r2p_requests(payer_participant, state);
CREATE INDEX IF NOT EXISTS r2p_requester_idx ON r2p_requests(requester_participant);
CREATE INDEX IF NOT EXISTS r2p_pending_expiry_idx ON r2p_requests(state, expires_at) WHERE state = 'PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS r2p_idempotency_uniq ON r2p_requests (requester_participant, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Per-month sequence for R2P-YYYYMM-NNNNNN.
CREATE TABLE IF NOT EXISTS r2p_request_sequence (
  bucket   TEXT PRIMARY KEY,
  seq      BIGINT NOT NULL DEFAULT 0
);
