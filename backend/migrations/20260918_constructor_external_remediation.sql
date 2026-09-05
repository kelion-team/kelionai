BEGIN;
-- A root-only maintenance reporter may attest work; it has no job execution authority.
CREATE TABLE constructor_external_owners (
  job_id BIGINT NOT NULL REFERENCES build_jobs(id) ON DELETE CASCADE,
  execution_cycle INTEGER NOT NULL CHECK (execution_cycle >= 0),
  coordinator TEXT NOT NULL,
  execution_id UUID NOT NULL UNIQUE,
  baseline_digest TEXT NOT NULL CHECK (baseline_digest ~ '^[0-9a-f]{64}$'),
  state TEXT NOT NULL CHECK (state IN ('working','blocked','completed')),
  evidence JSONB NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_concrete_activity_at TIMESTAMPTZ,
  active_until TIMESTAMPTZ,
  PRIMARY KEY(job_id,execution_cycle)
);
CREATE TABLE constructor_external_events (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES build_jobs(id) ON DELETE CASCADE,
  execution_cycle INTEGER NOT NULL CHECK (execution_cycle >= 0),
  execution_id UUID NOT NULL,
  coordinator TEXT NOT NULL,
  event_hash TEXT NOT NULL UNIQUE CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  evidence_digest TEXT NOT NULL CHECK (evidence_digest ~ '^[0-9a-f]{64}$'),
  event_type TEXT NOT NULL CHECK (event_type IN ('registration','takeover','report')),
  payload JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX constructor_external_events_identity ON constructor_external_events(job_id,execution_cycle,execution_id);
COMMIT;
