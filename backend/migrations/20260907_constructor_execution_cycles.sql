-- A retry that starts a new implementation must not inherit a terminal or
-- high-water progress event from the previous implementation. Archived work
-- is terminal-only, so no active job can become invisible while blocking the
-- serialized queue.
BEGIN;

UPDATE build_jobs
   SET arhivat=false
 WHERE arhivat=true AND status IN ('queued','running');

ALTER TABLE build_jobs
  ADD COLUMN IF NOT EXISTS execution_cycle INTEGER NOT NULL DEFAULT 0,
  DROP CONSTRAINT IF EXISTS build_jobs_archive_terminal_only,
  ADD CONSTRAINT build_jobs_archive_terminal_only
    CHECK (arhivat=false OR status IN ('done','failed','cancelled')),
  DROP CONSTRAINT IF EXISTS build_jobs_execution_cycle_nonnegative,
  ADD CONSTRAINT build_jobs_execution_cycle_nonnegative
    CHECK (execution_cycle >= 0);

ALTER TABLE constructor_activity_events
  ADD COLUMN IF NOT EXISTS execution_cycle INTEGER NOT NULL DEFAULT 0,
  DROP CONSTRAINT IF EXISTS constructor_activity_events_cycle_nonnegative,
  ADD CONSTRAINT constructor_activity_events_cycle_nonnegative
    CHECK (execution_cycle >= 0);

DROP INDEX IF EXISTS idx_constructor_activity_events_job_time;
CREATE INDEX idx_constructor_activity_events_job_cycle_time
  ON constructor_activity_events (job_id, execution_cycle, created_at, id);

CREATE OR REPLACE FUNCTION record_constructor_activity_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  selected_key TEXT;
  selected_stage TEXT;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.constructor_stage IS NOT DISTINCT FROM OLD.constructor_stage
     AND NEW.progress IS NOT DISTINCT FROM OLD.progress
     AND NEW.commit_sha IS NOT DISTINCT FROM OLD.commit_sha
     AND NEW.live_version IS NOT DISTINCT FROM OLD.live_version
     AND NEW.execution_cycle IS NOT DISTINCT FROM OLD.execution_cycle THEN
    RETURN NEW;
  END IF;

  selected_stage := COALESCE(NULLIF(NEW.constructor_stage, ''), NEW.status);
  IF TG_OP = 'UPDATE' AND NEW.execution_cycle IS DISTINCT FROM OLD.execution_cycle THEN
    INSERT INTO constructor_activity_events
      (job_id, execution_cycle, activity_key, stage_key, status)
    VALUES (NEW.id, NEW.execution_cycle, 'queued', 'queued', NEW.status);
  END IF;
  selected_key := CASE
    WHEN NEW.status = 'done' AND NEW.constructor_stage = 'deployed' THEN 'deployed'
    WHEN NEW.status = 'cancelled' OR (
      NEW.status = 'failed' AND lower(COALESCE(NEW.progress, '')) LIKE '%anulat%'
    ) THEN 'cancelled'
    WHEN NEW.progress = 'external_action_required' THEN 'external_action_required'
    WHEN NEW.progress IN (
      'worker_retry_scheduled',
      'owner_retry_scheduled',
      'stale_base_requeued',
      'publisher_retryable_failure',
      'release_retryable_failure',
      'release_retry_recovered'
    ) THEN 'automatic_retry'
    WHEN TG_OP = 'UPDATE' AND NEW.status = 'queued' AND OLD.status = 'running' THEN 'automatic_retry'
    ELSE selected_stage
  END;

  IF EXISTS (
    SELECT 1 FROM constructor_activity_catalog WHERE activity_key = selected_key
  ) THEN
    INSERT INTO constructor_activity_events
      (job_id, execution_cycle, activity_key, stage_key, status)
    VALUES (
      NEW.id,
      NEW.execution_cycle,
      selected_key,
      CASE WHEN EXISTS (
        SELECT 1 FROM constructor_activity_catalog
        WHERE activity_key = selected_stage AND sequence_no IS NOT NULL
      ) THEN selected_stage ELSE NULL END,
      NEW.status
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_constructor_activity_event ON build_jobs;
CREATE TRIGGER trg_constructor_activity_event
AFTER INSERT OR UPDATE OF status, constructor_stage, progress, commit_sha, live_version, execution_cycle
ON build_jobs FOR EACH ROW EXECUTE FUNCTION record_constructor_activity_event();

COMMIT;
