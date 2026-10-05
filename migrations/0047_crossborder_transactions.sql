CREATE TABLE IF NOT EXISTS crossborder_transactions (
  id                       UUID PRIMARY KEY,
  transaction_id           UUID UNIQUE NOT NULL REFERENCES transactions(id),
  foreign_rail_code        TEXT NOT NULL REFERENCES foreign_rails(rail_code),
  foreign_tx_id            TEXT,
  fx_quote_id              UUID NOT NULL REFERENCES fx_quotes(id),
  pay_currency             CHAR(3) NOT NULL,
  receive_currency         CHAR(3) NOT NULL,
  pay_amount_minor         NUMERIC(38,0) NOT NULL,
  receive_amount_minor     NUMERIC(38,0) NOT NULL,
  state                    TEXT NOT NULL DEFAULT 'INITIATED',
  leg_1_journal_id         UUID REFERENCES ledger_journal(id),
  leg_2_journal_id         UUID REFERENCES ledger_journal(id),
  compensate_journal_id    UUID REFERENCES ledger_journal(id),
  travel_rule_payload      JSONB NOT NULL,
  settlement_asset_type    TEXT NOT NULL DEFAULT 'LOCAL_CURRENCY_NET',
  initiated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  foreign_response_at      TIMESTAMPTZ,
  confirmed_at             TIMESTAMPTZ,
  rejected_at              TIMESTAMPTZ,
  attempts                 INT NOT NULL DEFAULT 0,
  next_attempt_at          TIMESTAMPTZ,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS xb_tx_state_idx ON crossborder_transactions(state);
CREATE INDEX IF NOT EXISTS xb_tx_foreign_rail_idx ON crossborder_transactions(foreign_rail_code);
CREATE INDEX IF NOT EXISTS xb_tx_pending_foreign_idx ON crossborder_transactions(state, next_attempt_at)
  WHERE state IN ('FOREIGN_INSTRUCTING', 'PENDING_FOREIGN');
