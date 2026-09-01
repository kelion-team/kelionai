-- Terminal worker outcomes remain unresolved until the owner explicitly
-- decides whether to switch model and use the existing Admin retry action.
BEGIN;

INSERT INTO constructor_activity_catalog
  (activity_key, sequence_no, label_ro, terminal, owner, rationale)
VALUES
  ('fast_insufficient', NULL, 'FAST 35B nu a produs un rezultat publicabil', true, 'codex-worker', 'Recomandarea POWERFUL este informativa; comutarea si reluarea raman exclusiv manuale'),
  ('technical_failure', NULL, 'Executia s-a oprit dintr-o cauza tehnica', true, 'codex-worker', 'O cadere tehnica nu este dovada de insuficienta a modelului'),
  ('powerful_final_failure', NULL, 'POWERFUL 122B nu a produs un rezultat publicabil', true, 'codex-worker', 'Rezultatul necesita diagnostic final si nu recomanda alt model'),
  ('manual_owner_retry', NULL, 'Ownerul a cerut explicit reluarea', false, 'admin', 'Numai comanda Reia porneste un ciclu nou de executie a modelului')
ON CONFLICT (activity_key) DO UPDATE SET
  sequence_no = EXCLUDED.sequence_no,
  label_ro = EXCLUDED.label_ro,
  terminal = EXCLUDED.terminal,
  owner = EXCLUDED.owner,
  rationale = EXCLUDED.rationale;

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
    WHEN NEW.progress IN ('fast_insufficient', 'technical_failure', 'powerful_final_failure') THEN NEW.progress
    WHEN NEW.progress = 'owner_retry_scheduled' THEN 'manual_owner_retry'
    WHEN NEW.progress = 'external_action_required' THEN 'external_action_required'
    WHEN NEW.progress IN (
      'publisher_retryable_failure',
      'release_retryable_failure',
      'release_retry_recovered'
    ) THEN 'automatic_retry'
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

CREATE OR REPLACE TRIGGER trg_constructor_activity_event
AFTER INSERT OR UPDATE OF status, constructor_stage, progress, commit_sha, live_version, execution_cycle
ON build_jobs FOR EACH ROW EXECUTE FUNCTION record_constructor_activity_event();

-- Generațiile anterioare puteau lăsa o nouă execuție de model deja programată
-- automat. După instalarea contractului manual, aceste două stări precise nu
-- trebuie să devină claimable fără o decizie nouă a ownerului. Nu atingem
-- coada inițială și nici `owner_retry_scheduled`, care dovedește ordinul manual.
UPDATE build_jobs
   SET status = 'failed',
       constructor_stage = 'failed',
       progress = 'technical_failure',
       progress_at = now(),
       retry_not_before = NULL,
       log = CASE
         WHEN progress = 'worker_retry_scheduled'
           THEN 'legacy_automatic_retry_terminalized:worker_retry_scheduled'
         ELSE 'legacy_automatic_retry_terminalized:stale_base_requeued'
       END,
       updated_at = now()
 WHERE status = 'queued'
   AND arhivat = false
   AND progress IN ('worker_retry_scheduled', 'stale_base_requeued');

INSERT INTO constructor_incidents
  (job_id, fingerprint, state, stage, cause_code, cause_summary, evidence, responsible, next_action)
SELECT b.id,
       'legacy-auto-retry-terminalized:' || b.id::text,
       'diagnosing',
       'local_executor',
       'unknown',
       'O reluare automată legacy a workerului a fost oprită înainte de claim.',
       b.log,
       'kelion',
       'Diagnostichează cauza legacy; această terminalizare nu recomandă schimbarea modelului sau Reia.'
  FROM build_jobs b
 WHERE b.status = 'failed'
   AND b.log IN (
     'legacy_automatic_retry_terminalized:worker_retry_scheduled',
     'legacy_automatic_retry_terminalized:stale_base_requeued'
   )
ON CONFLICT (fingerprint) DO UPDATE SET
  state = EXCLUDED.state,
  stage = EXCLUDED.stage,
  cause_code = EXCLUDED.cause_code,
  cause_summary = EXCLUDED.cause_summary,
  evidence = EXCLUDED.evidence,
  responsible = EXCLUDED.responsible,
  next_action = EXCLUDED.next_action,
  verification = NULL,
  lesson = NULL,
  closed_at = NULL,
  updated_at = now();

INSERT INTO constructor_activity_events
  (job_id, execution_cycle, activity_key, stage_key, status, created_at)
SELECT b.id, b.execution_cycle, b.progress, NULL, b.status, COALESCE(b.updated_at, now())
  FROM build_jobs b
 WHERE b.progress IN ('fast_insufficient', 'technical_failure', 'powerful_final_failure')
   AND NOT EXISTS (
     SELECT 1
       FROM constructor_activity_events e
      WHERE e.job_id=b.id
        AND e.execution_cycle=b.execution_cycle
        AND e.activity_key=b.progress
   );

COMMIT;
