CREATE TABLE IF NOT EXISTS settlement_cycles (
  id                  UUID PRIMARY KEY,
  cycle_type          TEXT NOT NULL,
  currency            CHAR(3) NOT NULL,
  operating_date      DATE NOT NULL,
  triggered_by        TEXT NOT NULL,
  triggered_reason    TEXT,
  state               TEXT NOT NULL DEFAULT 'pending',
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  net_movement_count  INT,
  total_dr_minor      NUMERIC(38,0),
  total_cr_minor      NUMERIC(38,0),
  rtgs_output_path    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS settlement_cycles_date_idx ON settlement_cycles(operating_date, currency);
CREATE INDEX IF NOT EXISTS settlement_cycles_state_idx ON settlement_cycles(state);

CREATE TABLE IF NOT EXISTS settlement_cycle_movements (
  id                  UUID PRIMARY KEY,
  cycle_id            UUID NOT NULL REFERENCES settlement_cycles(id) ON DELETE RESTRICT,
  participant_code    TEXT NOT NULL,
  currency            CHAR(3) NOT NULL,
  net_position_minor  NUMERIC(38,0) NOT NULL,
  movement_minor      NUMERIC(38,0) NOT NULL,
  posted_journal_id   UUID REFERENCES ledger_journal(id),
  UNIQUE (cycle_id, participant_code, currency)
);

CREATE INDEX IF NOT EXISTS cycle_movements_cycle_idx ON settlement_cycle_movements(cycle_id);
