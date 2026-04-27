CREATE TABLE IF NOT EXISTS participant_kyb (
  id                  UUID PRIMARY KEY,
  participant_id      UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  doc_type            TEXT NOT NULL,
  doc_filename        TEXT NOT NULL,
  doc_sha256          TEXT NOT NULL,
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by         UUID REFERENCES users(id),
  reviewed_at         TIMESTAMPTZ,
  reviewed_by         UUID REFERENCES users(id),
  review_status       TEXT,
  review_note         TEXT,
  UNIQUE (participant_id, doc_type)
);

CREATE TABLE IF NOT EXISTS participant_certifications (
  id                  UUID PRIMARY KEY,
  participant_id      UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  test_suite          TEXT NOT NULL,
  status              TEXT NOT NULL,
  ran_at              TIMESTAMPTZ,
  result              JSONB,
  UNIQUE (participant_id, test_suite)
);

CREATE INDEX IF NOT EXISTS participant_kyb_participant_idx ON participant_kyb(participant_id);
CREATE INDEX IF NOT EXISTS participant_certifications_participant_idx ON participant_certifications(participant_id);
