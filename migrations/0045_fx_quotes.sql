CREATE TABLE IF NOT EXISTS fx_quotes (
  id                       UUID PRIMARY KEY,
  pay_currency             CHAR(3) NOT NULL,
  receive_currency         CHAR(3) NOT NULL,
  pay_amount_minor         NUMERIC(38,0) NOT NULL,
  receive_amount_minor     NUMERIC(38,0) NOT NULL,
  rate_decimal_str         TEXT NOT NULL,
  market_maker_id          UUID,
  fee_pay_minor            NUMERIC(38,0) NOT NULL DEFAULT 0,
  fee_receive_minor        NUMERIC(38,0) NOT NULL DEFAULT 0,
  state                    TEXT NOT NULL DEFAULT 'OPEN',
  quoted_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at               TIMESTAMPTZ NOT NULL,
  consumed_transaction_id  UUID REFERENCES transactions(id),
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS fx_quotes_active_idx ON fx_quotes(state) WHERE state IN ('OPEN', 'LOCKED');
CREATE INDEX IF NOT EXISTS fx_quotes_pair_idx ON fx_quotes(pay_currency, receive_currency, quoted_at DESC);
