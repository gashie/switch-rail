CREATE TABLE IF NOT EXISTS travel_rule_records (
  id                       UUID PRIMARY KEY,
  crossborder_tx_id        UUID REFERENCES crossborder_transactions(id),
  transaction_id           UUID REFERENCES transactions(id),
  direction                TEXT NOT NULL,
  originator_id_type       TEXT NOT NULL,
  originator_id_hashed     TEXT NOT NULL,
  originator_address       TEXT NOT NULL,
  originator_dob           DATE,
  originator_jurisdiction  CHAR(2) NOT NULL,
  beneficiary_id_type      TEXT NOT NULL,
  beneficiary_id_hashed    TEXT NOT NULL,
  beneficiary_address      TEXT NOT NULL,
  beneficiary_dob          DATE,
  beneficiary_jurisdiction CHAR(2) NOT NULL,
  purpose_of_payment       TEXT NOT NULL,
  sanctions_screened_at    TIMESTAMPTZ,
  sanctions_hit            BOOLEAN NOT NULL DEFAULT false,
  sanctions_hit_details    JSONB,
  enforced_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tr_xbtx_idx ON travel_rule_records(crossborder_tx_id);
CREATE INDEX IF NOT EXISTS tr_tx_idx ON travel_rule_records(transaction_id);
CREATE INDEX IF NOT EXISTS tr_jurisdiction_idx
  ON travel_rule_records(originator_jurisdiction, beneficiary_jurisdiction);
