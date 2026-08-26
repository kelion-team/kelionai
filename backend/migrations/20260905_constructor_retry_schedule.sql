-- Persisted retry scheduling for the full Constructor path. Retry timing must
-- survive web/worker restarts and must never be inferred by the browser.
BEGIN;

ALTER TABLE build_jobs
  ADD COLUMN IF NOT EXISTS retry_not_before TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_build_jobs_constructor_retry
  ON build_jobs (retry_not_before, created_at)
  WHERE status = 'queued';

-- Keep activity reconstruction aligned with the canonical cancellation and
-- retry states introduced after the original observability migration.
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
     AND NEW.live_version IS NOT DISTINCT FROM OLD.live_version THEN
    RETURN NEW;
  END IF;

  selected_stage := COALESCE(NULLIF(NEW.constructor_stage, ''), NEW.status);
  selected_key := CASE
    WHEN NEW.status = 'done' AND NEW.constructor_stage = 'deployed' THEN 'deployed'
    WHEN NEW.status = 'cancelled' OR (
      NEW.status = 'failed' AND lower(COALESCE(NEW.progress, '')) LIKE '%anulat%'
    ) THEN 'cancelled'
    WHEN NEW.progress = 'external_action_required' THEN 'external_action_required'
    WHEN NEW.progress IN (
      'worker_retry_scheduled',
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
    INSERT INTO constructor_activity_events (job_id, activity_key, stage_key, status)
    VALUES (
      NEW.id,
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

COMMIT;
