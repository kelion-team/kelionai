BEGIN;

-- A Google administrator explicitly grants bounded unattended intake. This is
-- separate from authentication sessions; logout never manufactures a session.
CREATE TABLE doctor_grants (
  id UUID PRIMARY KEY,
  admin_email TEXT NOT NULL REFERENCES user_prefs(user_email) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope='measured-code-repair'),
  expires_at TIMESTAMPTZ,
  max_jobs INTEGER NOT NULL CHECK (max_jobs BETWEEN 1 AND 5),
  window_hours INTEGER NOT NULL CHECK (window_hours BETWEEN 1 AND 24),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  jobs_created INTEGER NOT NULL DEFAULT 0 CHECK (jobs_created >= 0),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX doctor_grants_one_active ON doctor_grants(admin_email) WHERE revoked_at IS NULL;

CREATE TABLE doctor_incidents (
  id UUID PRIMARY KEY,
  grant_id UUID REFERENCES doctor_grants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  release_sha TEXT NOT NULL CHECK (release_sha ~ '^[0-9a-f]{40}$'),
  status TEXT NOT NULL CHECK (status IN ('observed','blocked','queued','repairing','awaiting_live','resolved')),
  summary TEXT NOT NULL CHECK (length(summary) <= 300),
  evidence JSONB NOT NULL,
  job_id BIGINT UNIQUE REFERENCES build_jobs(id) ON DELETE SET NULL,
  repair_attempted BOOLEAN NOT NULL DEFAULT false,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closure JSONB,
  CHECK ((status='resolved') = (closure IS NOT NULL))
);
CREATE INDEX doctor_incidents_open_code ON doctor_incidents(code) WHERE status <> 'resolved';

CREATE TABLE doctor_lease (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  owner UUID,
  until_at TIMESTAMPTZ,
  checked_at TIMESTAMPTZ,
  checked_release_sha TEXT CHECK (checked_release_sha IS NULL OR checked_release_sha ~ '^[0-9a-f]{40}$'),
  last_error TEXT
);
INSERT INTO doctor_lease(singleton) VALUES (true);

-- Only automatic AI execution is bounded here. Publication/release polling
-- remains idempotent on the same handoff and commit.
ALTER TABLE build_jobs ADD COLUMN automatic_retry_limit INTEGER NOT NULL DEFAULT 3
  CHECK (automatic_retry_limit BETWEEN 1 AND 3);
ALTER TABLE build_jobs ADD COLUMN automation_origin TEXT NOT NULL DEFAULT 'admin'
  CHECK (automation_origin IN ('admin','doctor'));
ALTER TABLE build_jobs ADD COLUMN repair_scope JSONB;
ALTER TABLE build_jobs ADD CONSTRAINT constructor_automation_scope CHECK (
  (automation_origin='admin' AND repair_scope IS NULL)
  OR (automation_origin='doctor' AND automatic_retry_limit=1 AND repair_scope IS NOT NULL)
);

COMMIT;
