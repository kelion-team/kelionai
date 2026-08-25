-- Canonical, refresh-safe Constructor observability and autonomous recovery.
-- Current state remains owned by build_jobs; this table is the append-only
-- history of authoritative transitions, not a second mutable state field.
BEGIN;

ALTER TABLE constructor_pipeline
  DROP CONSTRAINT IF EXISTS constructor_pipeline_publisher_attempts_check;
ALTER TABLE constructor_pipeline
  DROP CONSTRAINT IF EXISTS constructor_pipeline_release_attempts_check;

DROP INDEX IF EXISTS idx_constructor_pipeline_publisher_claim;
CREATE INDEX idx_constructor_pipeline_publisher_claim
  ON constructor_pipeline (publisher_lease_until, handoff_created_at)
  WHERE merged_commit_sha IS NULL;

DROP INDEX IF EXISTS idx_constructor_pipeline_release_claim;
CREATE INDEX idx_constructor_pipeline_release_claim
  ON constructor_pipeline (release_lease_until, updated_at)
  WHERE merged_commit_sha IS NOT NULL AND release_receipt_sha256 IS NULL;

CREATE TABLE IF NOT EXISTS constructor_activity_catalog (
  activity_key TEXT PRIMARY KEY,
  sequence_no INTEGER UNIQUE CHECK (sequence_no IS NULL OR sequence_no >= 0),
  label_ro TEXT NOT NULL,
  terminal BOOLEAN NOT NULL DEFAULT false,
  owner TEXT NOT NULL,
  rationale TEXT NOT NULL
);

INSERT INTO constructor_activity_catalog
  (activity_key, sequence_no, label_ro, terminal, owner, rationale)
VALUES
  ('queued', 0, 'Cererea a fost acceptata', false, 'constructor-orchestrator', 'Intrarea canonica in coada persistenta'),
  ('claimed', 1, 'Constructorul a preluat cererea', false, 'codex-worker', 'Lease activ confirmat de worker'),
  ('accepted', 2, 'Executia a fost acceptata', false, 'codex-worker', 'Serviciul de executie a confirmat taskul'),
  ('working', 3, 'Constructorul executa cererea', false, 'codex-worker', 'Executie reala raportata de serviciu'),
  ('gates_passed', 4, 'Verificarile locale au trecut', false, 'codex-worker', 'Handoff semnat dupa gate-uri reale'),
  ('pr_opened', 5, 'Pull request-ul protejat este deschis', false, 'constructor-publisher', 'PR canonic creat in GitHub'),
  ('merged', 6, 'Versiunea a intrat in master', false, 'constructor-publisher', 'Merge protejat confirmat de GitHub'),
  ('release_dispatched', 7, 'Deploy-ul a fost pornit', false, 'constructor-release', 'Run de deploy canonic confirmat'),
  ('deployed', 8, 'Rezultatul este live si verificat', true, 'constructor-release', 'Versiunea publica si readiness au fost probate'),
  ('automatic_retry', NULL, 'Recuperare automata pornita', false, 'constructor-orchestrator', 'O tranzitie recuperabila este reluata fara actiune manuala'),
  ('external_action_required', NULL, 'Este necesara o singura autorizare externa', false, 'constructor-orchestrator', 'Numai o autoritate externa ireversibila poate cere interventie'),
  ('cancelled', NULL, 'Cererea a fost anulata de administrator', true, 'admin', 'Anularea explicita este un rezultat terminal rezolvat')
ON CONFLICT (activity_key) DO UPDATE SET
  sequence_no = EXCLUDED.sequence_no,
  label_ro = EXCLUDED.label_ro,
  terminal = EXCLUDED.terminal,
  owner = EXCLUDED.owner,
  rationale = EXCLUDED.rationale;

CREATE TABLE IF NOT EXISTS constructor_activity_events (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES build_jobs(id) ON DELETE CASCADE,
  activity_key TEXT NOT NULL REFERENCES constructor_activity_catalog(activity_key),
  stage_key TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_constructor_activity_events_job_time
  ON constructor_activity_events (job_id, created_at, id);

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
    WHEN NEW.status = 'failed' AND lower(COALESCE(NEW.progress, '')) LIKE '%anulat%' THEN 'cancelled'
    WHEN NEW.progress = 'external_action_required' THEN 'external_action_required'
    WHEN NEW.progress IN (
      'worker_retry_scheduled',
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

DROP TRIGGER IF EXISTS trg_constructor_activity_event ON build_jobs;
CREATE TRIGGER trg_constructor_activity_event
AFTER INSERT OR UPDATE OF status, constructor_stage, progress, commit_sha, live_version
ON build_jobs FOR EACH ROW EXECUTE FUNCTION record_constructor_activity_event();

INSERT INTO constructor_activity_events (job_id, activity_key, stage_key, status, created_at)
SELECT b.id, c.activity_key,
       CASE WHEN c.sequence_no IS NOT NULL THEN c.activity_key ELSE NULL END,
       b.status, COALESCE(b.updated_at, now())
FROM build_jobs b
JOIN constructor_activity_catalog c
  ON c.activity_key = CASE
    WHEN b.status = 'done' AND b.constructor_stage = 'deployed' THEN 'deployed'
    WHEN b.status = 'failed' AND lower(COALESCE(b.progress, '')) LIKE '%anulat%' THEN 'cancelled'
    ELSE COALESCE(NULLIF(b.constructor_stage, ''), b.status)
  END
WHERE NOT EXISTS (
  SELECT 1 FROM constructor_activity_events e WHERE e.job_id = b.id
);

COMMIT;
