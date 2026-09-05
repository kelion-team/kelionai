BEGIN;

-- Historical retry-limit values remain for the Doctor authority constraint and
-- audit compatibility. They no longer authorize another worker claim.
ALTER TABLE build_jobs ALTER COLUMN automatic_retry_limit SET DEFAULT 1;
COMMENT ON COLUMN build_jobs.automatic_retry_limit IS
  'Historical compatibility/Doctor authority field; worker execution never retries automatically';

-- A previous writer could schedule a second AI run after a signed technical
-- failure. Only this exact, already-attempted worker state is reconciled.
-- Keep the task ID exactly as stored (possibly NULL), cycle, profile, log,
-- attempts and earlier activity events. Never invent a missing old task ID.
WITH terminalized AS (
  UPDATE build_jobs b
     SET status='failed',
         constructor_stage='failed',
         retry_not_before=NULL,
         progress_at=now(),
         updated_at=now()
   WHERE b.status='queued'
     AND b.constructor_stage='queued'
     AND b.arhivat=false
     AND b.attempts > 0
     AND b.progress='technical_failure'
     AND b.execution_profile IN ('fast','powerful')
     AND b.log IN (
       'worker_failure:execution_timeout;profile=' || b.execution_profile,
       'worker_failure:brain_unavailable;profile=' || b.execution_profile,
       'worker_failure:worker_internal_failure;profile=' || b.execution_profile
     )
     AND NOT EXISTS (
       SELECT 1 FROM constructor_pipeline p WHERE p.job_id=b.id
     )
  RETURNING b.id,b.execution_cycle,b.log
)
INSERT INTO constructor_incidents
  (job_id,fingerprint,state,stage,cause_code,cause_summary,evidence,responsible,next_action)
SELECT id,
       'worker-auto-retry-terminalized:' || id::text || ':' || execution_cycle::text,
       'diagnosing',
       'local_executor',
       'unknown',
       'Reluarea automată a fost oprită pe baza eșecului tehnic deja înregistrat.',
       log,
       'kelion',
       'Diagnostichează cauza tehnică păstrată; nu reinvoca modelul automat.'
  FROM terminalized
ON CONFLICT (fingerprint) DO NOTHING;

COMMIT;
