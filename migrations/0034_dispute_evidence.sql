CREATE TABLE IF NOT EXISTS dispute_evidence (
  id                       UUID PRIMARY KEY,
  case_id                  UUID NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
  side                     TEXT NOT NULL,
  uploaded_by_participant  TEXT,
  uploaded_by_user         UUID REFERENCES users(id),
  evidence_type            TEXT NOT NULL,
  filename                 TEXT NOT NULL,
  content_sha256           TEXT NOT NULL,
  content_size_bytes       BIGINT NOT NULL,
  mime_type                TEXT,
  description              TEXT,
  uploaded_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  rail_timestamp           TIMESTAMPTZ NOT NULL DEFAULT now(),
  rail_signature_b64       TEXT NOT NULL,
  rail_signature_kid       TEXT NOT NULL,
  prev_evidence_hash       TEXT NOT NULL,
  evidence_chain_hash      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS evidence_case_idx ON dispute_evidence(case_id);
CREATE INDEX IF NOT EXISTS evidence_uploaded_at_idx ON dispute_evidence(uploaded_at);

-- Comments table for B7.6 customer portal. Lives here next to evidence
-- so audit/cleanup queries are simple.
CREATE TABLE IF NOT EXISTS dispute_comments (
  id                  UUID PRIMARY KEY,
  case_id             UUID NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
  author_kind         TEXT NOT NULL,                 -- 'CUSTOMER' | 'OPERATOR' | 'PARTICIPANT'
  author_ref          TEXT,                          -- customer_ref / participant_code / user_id (opaque)
  body                TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comments_case_idx ON dispute_comments(case_id);

-- IP-based rate limit counter for the customer portal (B7.6). Rolling
-- window is computed by querying within the last minute; rows older than
-- 24h are pruned by the maintenance worker.
CREATE TABLE IF NOT EXISTS dispute_portal_hits (
  id              UUID PRIMARY KEY,
  ip              TEXT NOT NULL,
  endpoint        TEXT NOT NULL,
  hit_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_hits_ip_idx ON dispute_portal_hits(ip, hit_at);
