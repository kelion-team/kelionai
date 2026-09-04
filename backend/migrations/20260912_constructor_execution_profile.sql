-- The exact manually selected model is part of each claimed execution.  It is
-- persisted before the worker starts so a silent-worker watchdog can report a
-- bounded terminal failure without guessing or switching models.
BEGIN;

ALTER TABLE build_jobs
  ADD COLUMN IF NOT EXISTS execution_profile TEXT,
  DROP CONSTRAINT IF EXISTS build_jobs_execution_profile_valid,
  ADD CONSTRAINT build_jobs_execution_profile_valid
    CHECK (execution_profile IS NULL OR execution_profile IN ('fast', 'powerful'));

-- Preserve profiles already proved by exact terminal worker evidence.  Older
-- active rows without such evidence remain explicitly unrecorded; the runtime
-- never invents FAST or POWERFUL for them.
UPDATE build_jobs
   SET execution_profile = substring(
     log FROM '^worker_(?:failure|unresolved):[a-z_]+;profile=(fast|powerful)$'
   )
 WHERE execution_profile IS NULL
   AND log ~ '^worker_(?:failure|unresolved):[a-z_]+;profile=(fast|powerful)$';

COMMIT;
