CREATE TABLE IF NOT EXISTS qr_codes (
  id                       UUID PRIMARY KEY,
  qr_type                  TEXT NOT NULL,
  merchant_participant     TEXT NOT NULL REFERENCES participants(code),
  merchant_account_id      UUID NOT NULL REFERENCES accounts(id),
  merchant_alias_type      TEXT,
  merchant_alias_value     TEXT,
  merchant_name            TEXT NOT NULL,
  merchant_city            TEXT,
  mcc                      TEXT NOT NULL,
  amount_minor             NUMERIC(38,0),
  currency                 CHAR(3) NOT NULL,
  reference                TEXT,
  expires_at               TIMESTAMPTZ,
  encoded_payload          TEXT NOT NULL,
  state                    TEXT NOT NULL DEFAULT 'ACTIVE',
  consumed_transaction_id  UUID REFERENCES transactions(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qr_merchant_idx ON qr_codes(merchant_participant);
CREATE INDEX IF NOT EXISTS qr_active_idx ON qr_codes(state) WHERE state = 'ACTIVE';
