-- Phase 10 — operations metrics + status incidents.
--
-- ops_metric_snapshots: append-only roll-ups produced by the ops-dashboard
-- service (or a future cron) capturing TPS, success rate, latency, and
-- volume by rail-class. The dashboard reads recent snapshots; nothing
-- mutates a snapshot once it lands.
--
-- status_incidents: rail-wide incidents declared by the operator. Citizens
-- and integrators read these via the public-status surface. A new
-- update is a row in status_incident_updates rather than mutation, so
-- the audit chain stays append-only.

CREATE TABLE IF NOT EXISTS ops_metric_snapshots (
  id              UUID PRIMARY KEY,
  bucket_minute   TIMESTAMPTZ NOT NULL,
  metric_kind     TEXT NOT NULL,
  rail_class      TEXT,
  value_numeric   NUMERIC(38,6),
  value_count     BIGINT,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ops_metric_bucket_idx
  ON ops_metric_snapshots(bucket_minute DESC, metric_kind);

CREATE TABLE IF NOT EXISTS status_incidents (
  id              UUID PRIMARY KEY,
  scope           TEXT NOT NULL,
  severity        TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  state           TEXT NOT NULL DEFAULT 'OPEN',
  declared_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  declared_by     TEXT NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS status_incidents_state_idx ON status_incidents(state, declared_at DESC);

CREATE TABLE IF NOT EXISTS status_incident_updates (
  id              UUID PRIMARY KEY,
  incident_id     UUID NOT NULL REFERENCES status_incidents(id),
  body            TEXT NOT NULL,
  posted_by       TEXT NOT NULL,
  posted_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS status_incident_updates_incident_idx
  ON status_incident_updates(incident_id, posted_at);

-- ussd_sessions: captures USSD interactions (one row per *NETWORK request).
-- The ussd-gateway service appends rows; nothing mutates them. Useful for
-- audit + replay.

CREATE TABLE IF NOT EXISTS ussd_sessions (
  id              UUID PRIMARY KEY,
  msisdn          TEXT NOT NULL,
  short_code      TEXT NOT NULL,
  step            TEXT NOT NULL,
  input_text      TEXT,
  response_text   TEXT,
  outcome         TEXT NOT NULL,
  initiated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ussd_sessions_msisdn_idx ON ussd_sessions(msisdn, initiated_at DESC);
