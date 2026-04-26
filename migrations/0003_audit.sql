CREATE TABLE IF NOT EXISTS audit_events (
  id            UUID PRIMARY KEY,
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  day           DATE NOT NULL,
  seq           BIGSERIAL UNIQUE,
  actor_type    TEXT NOT NULL,
  actor_id      TEXT,
  event_type    TEXT NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash     TEXT NOT NULL,
  hash          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_day_idx ON audit_events(day);
CREATE INDEX IF NOT EXISTS audit_event_idx ON audit_events(event_type);
CREATE INDEX IF NOT EXISTS audit_resource_idx ON audit_events(resource_type, resource_id);

CREATE TABLE IF NOT EXISTS audit_day_anchor (
  day        DATE PRIMARY KEY,
  first_seq  BIGINT NOT NULL,
  last_seq   BIGINT NOT NULL,
  last_hash  TEXT NOT NULL,
  closed_at  TIMESTAMPTZ
);
