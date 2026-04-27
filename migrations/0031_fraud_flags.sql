CREATE TABLE IF NOT EXISTS fraud_flags (
  id                   UUID PRIMARY KEY,
  flagged_subject_type TEXT NOT NULL,
  flagged_subject_key  TEXT NOT NULL,
  flag_type            TEXT NOT NULL,
  flagged_by           TEXT NOT NULL,
  evidence             JSONB,
  severity             INT NOT NULL DEFAULT 70,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at           TIMESTAMPTZ,
  withdrawn_at         TIMESTAMPTZ,
  UNIQUE (flagged_subject_type, flagged_subject_key, flagged_by, flag_type)
);

CREATE INDEX IF NOT EXISTS fflags_subject_active_idx
  ON fraud_flags(flagged_subject_type, flagged_subject_key)
  WHERE withdrawn_at IS NULL;
