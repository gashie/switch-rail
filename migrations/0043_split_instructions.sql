CREATE TABLE IF NOT EXISTS split_instructions (
  id                       UUID PRIMARY KEY,
  split_number             TEXT UNIQUE NOT NULL,
  payer_participant        TEXT NOT NULL REFERENCES participants(code),
  payer_account_id         UUID NOT NULL REFERENCES accounts(id),
  total_amount_minor       NUMERIC(38,0) NOT NULL,
  currency                 CHAR(3) NOT NULL,
  state                    TEXT NOT NULL DEFAULT 'INITIATED',
  reference                TEXT,
  master_transaction_id    UUID REFERENCES transactions(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS split_state_idx ON split_instructions(state);

CREATE TABLE IF NOT EXISTS split_legs (
  id                       UUID PRIMARY KEY,
  split_id                 UUID NOT NULL REFERENCES split_instructions(id) ON DELETE RESTRICT,
  leg_index                INT NOT NULL,
  beneficiary_participant  TEXT NOT NULL,
  beneficiary_account_id   UUID NOT NULL REFERENCES accounts(id),
  amount_minor             NUMERIC(38,0) NOT NULL,
  description              TEXT,
  transaction_id           UUID REFERENCES transactions(id),
  result                   TEXT,
  UNIQUE (split_id, leg_index)
);

CREATE INDEX IF NOT EXISTS split_legs_split_idx ON split_legs(split_id);

CREATE TABLE IF NOT EXISTS split_sequence (
  bucket   TEXT PRIMARY KEY,
  seq      BIGINT NOT NULL DEFAULT 0
);
