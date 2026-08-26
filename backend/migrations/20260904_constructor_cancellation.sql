-- Cancellation is a distinct resolved Constructor outcome. Keep its durable
-- stage/event aligned with build_jobs so Admin and the live monitor reconstruct
-- the same state after refresh.
BEGIN;

UPDATE build_jobs
   SET constructor_stage = 'cancelled',
       progress = 'cancelled_by_admin',
       progress_at = COALESCE(progress_at, updated_at, now()),
       codex_task_id = NULL
 WHERE status = 'cancelled'
   AND (
     constructor_stage IS DISTINCT FROM 'cancelled'
     OR progress IS DISTINCT FROM 'cancelled_by_admin'
     OR codex_task_id IS NOT NULL
   );

INSERT INTO constructor_activity_events
  (job_id, activity_key, stage_key, status, created_at)
SELECT b.id, 'cancelled', NULL, 'cancelled', COALESCE(b.updated_at, now())
  FROM build_jobs b
 WHERE b.status = 'cancelled'
   AND NOT EXISTS (
     SELECT 1
       FROM constructor_activity_events e
      WHERE e.job_id = b.id AND e.activity_key = 'cancelled'
   );

COMMIT;
