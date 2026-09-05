BEGIN;
-- Read-only observer of build_jobs; no trigger, requeue, retry or execution authority.
CREATE TABLE constructor_monitor_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  lease_owner UUID,
  lease_until TIMESTAMPTZ,
  checked_at TIMESTAMPTZ,
  last_successful_check TIMESTAMPTZ,
  last_error TEXT CHECK (last_error IS NULL OR last_error IN ('constructor_monitor_check_failed'))
);
INSERT INTO constructor_monitor_state(singleton) VALUES (true);
CREATE TABLE constructor_monitor_cases (
  job_id BIGINT NOT NULL REFERENCES build_jobs(id) ON DELETE CASCADE,
  execution_cycle INTEGER NOT NULL CHECK (execution_cycle >= 0),
  code TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  open_incident BOOLEAN NOT NULL DEFAULT false,
  evidence JSONB NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(job_id,execution_cycle)
);
CREATE TABLE constructor_monitor_events (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL,
  execution_cycle INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('incident','state_change','recovery')),
  evidence JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(job_id,execution_cycle,revision),
  FOREIGN KEY(job_id,execution_cycle) REFERENCES constructor_monitor_cases(job_id,execution_cycle) ON DELETE CASCADE
);
COMMIT;
