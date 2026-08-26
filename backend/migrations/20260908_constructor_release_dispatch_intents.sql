-- A production workflow is an external side effect.  Persist its deterministic
-- intent before dispatch, then retain a terminal retirement receipt before a
-- newer master target may replace it.  This closes both process-crash windows:
-- dispatch-before-DB-ack and failed-old-run-before-new-target.
BEGIN;

ALTER TABLE constructor_pipeline
  ADD COLUMN IF NOT EXISTS release_intent_receipt_sha256 TEXT
    CHECK (release_intent_receipt_sha256 IS NULL OR release_intent_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS release_intent_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS release_legacy_ambiguity_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS release_protocol_version SMALLINT NOT NULL DEFAULT 2
    CHECK (release_protocol_version IN (1, 2));

-- Un rând revendicat de vechiul dispatcher este protocol v1 *ambiguu*:
-- attempts>0 nu dovedește că POST-ul a ajuns la GitHub. Releaserul nou caută
-- exhaustiv request id-ul v1 determinist. Dacă lipsește și fereastra de
-- consistență a expirat, persistă o dovadă append-only și convertește rândul
-- la v2; nu retrimite niciodată un side effect v1 ambiguu. Un merged neatins
-- (attempts=0 și fără request/run/receipt) nu putea emite workflow-ul vechi și
-- rămâne v2.
UPDATE constructor_pipeline p
   SET release_protocol_version=1,
       release_legacy_ambiguity_started_at=transaction_timestamp()
  FROM build_jobs b
 WHERE b.id=p.job_id
   AND b.status='running'
   AND b.constructor_stage='merged'
   AND p.release_attempts > 0
   AND p.release_target_sha IS NULL
   AND p.release_target_receipt_sha256 IS NULL
   AND p.release_request_id IS NULL
   AND p.release_intent_receipt_sha256 IS NULL
   AND p.release_intent_created_at IS NULL
   AND p.release_workflow_run_id IS NULL
   AND p.release_dispatch_receipt_sha256 IS NULL
   AND p.release_ci_run_id IS NULL
   AND p.release_build_run_id IS NULL
   AND p.release_artifact_id IS NULL
   AND p.release_candidate_receipt_sha256 IS NULL;

-- Un checkpoint extern complet poate fi reconciliat direct. Nu clasificăm
-- niciodată un tuple parțial drept dovadă de dispatch.
UPDATE constructor_pipeline
   SET release_protocol_version=1
 WHERE release_intent_receipt_sha256 IS NULL
   AND release_request_id IS NOT NULL
   AND release_workflow_run_id IS NOT NULL
   AND release_dispatch_receipt_sha256 IS NOT NULL;

UPDATE build_jobs b
   SET ci=COALESCE(b.ci, 'pr_checks_green')
  FROM constructor_pipeline p
 WHERE p.job_id=b.id AND p.release_protocol_version=1;

ALTER TABLE constructor_pipeline
  DROP CONSTRAINT IF EXISTS constructor_pipeline_release_dispatch_checkpoint_complete,
  ADD CONSTRAINT constructor_pipeline_release_dispatch_checkpoint_complete CHECK (
    (
      release_request_id IS NULL
      AND release_intent_receipt_sha256 IS NULL
      AND release_intent_created_at IS NULL
      AND release_workflow_run_id IS NULL
      AND release_dispatch_receipt_sha256 IS NULL
    ) OR (
      release_request_id IS NOT NULL
      AND release_intent_receipt_sha256 IS NOT NULL
      AND release_intent_created_at IS NOT NULL
      AND release_workflow_run_id IS NULL
      AND release_dispatch_receipt_sha256 IS NULL
    ) OR (
      -- Existing fully-dispatched rows predate the intent receipt.  They remain
      -- recoverable, but every new dispatch writes the intent first.
      release_request_id IS NOT NULL
      AND release_workflow_run_id IS NOT NULL
      AND release_dispatch_receipt_sha256 IS NOT NULL
      AND (
        release_protocol_version = 1
        OR (release_intent_receipt_sha256 IS NOT NULL AND release_intent_created_at IS NOT NULL)
      )
    )
  );

ALTER TABLE constructor_pipeline
  DROP CONSTRAINT IF EXISTS constructor_pipeline_release_legacy_ambiguity_shape,
  ADD CONSTRAINT constructor_pipeline_release_legacy_ambiguity_shape CHECK (
    release_legacy_ambiguity_started_at IS NULL OR (
      release_protocol_version=1
      AND release_target_sha IS NULL
      AND release_target_receipt_sha256 IS NULL
      AND release_request_id IS NULL
      AND release_intent_receipt_sha256 IS NULL
      AND release_intent_created_at IS NULL
      AND release_workflow_run_id IS NULL
      AND release_dispatch_receipt_sha256 IS NULL
      AND release_ci_run_id IS NULL
      AND release_build_run_id IS NULL
      AND release_artifact_id IS NULL
      AND release_candidate_receipt_sha256 IS NULL
    )
  );

CREATE TABLE IF NOT EXISTS constructor_release_legacy_resolutions (
  id BIGSERIAL PRIMARY KEY,
  -- Fără FK cascade: dovada operațională supraviețuiește ștergerii rândului UI.
  job_id BIGINT NOT NULL,
  task_id TEXT NOT NULL,
  merged_commit_sha TEXT NOT NULL CHECK (merged_commit_sha ~ '^[0-9a-f]{40}$'),
  request_id UUID NOT NULL,
  ambiguity_started_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  master_sha TEXT NOT NULL CHECK (master_sha ~ '^[0-9a-f]{40}$'),
  resolution_receipt_sha256 TEXT NOT NULL UNIQUE CHECK (resolution_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  UNIQUE(job_id, request_id)
);

CREATE TABLE IF NOT EXISTS constructor_release_retirements (
  id BIGSERIAL PRIMARY KEY,
  -- Deliberately no cascading FK: operational proof outlives presentation-row
  -- cleanup in build_jobs.
  job_id BIGINT NOT NULL,
  task_id TEXT NOT NULL,
  target_sha TEXT NOT NULL CHECK (target_sha ~ '^[0-9a-f]{40}$'),
  replacement_target_sha TEXT NOT NULL CHECK (replacement_target_sha ~ '^[0-9a-f]{40}$'),
  target_receipt_sha256 TEXT NOT NULL CHECK (target_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  request_id UUID NOT NULL UNIQUE,
  workflow_run_id BIGINT UNIQUE CHECK (workflow_run_id IS NULL OR workflow_run_id > 0),
  ci_run_id BIGINT NOT NULL CHECK (ci_run_id > 0),
  build_run_id BIGINT NOT NULL CHECK (build_run_id > 0),
  artifact_id BIGINT NOT NULL CHECK (artifact_id > 0),
  candidate_receipt_sha256 TEXT NOT NULL CHECK (candidate_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  intent_receipt_sha256 TEXT CHECK (intent_receipt_sha256 IS NULL OR intent_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  dispatch_receipt_sha256 TEXT CHECK (dispatch_receipt_sha256 IS NULL OR dispatch_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  conclusion TEXT NOT NULL CHECK (conclusion IN (
    'action_required', 'cancelled', 'failure', 'neutral', 'skipped',
    'stale', 'startup_failure', 'timed_out', 'intent_not_materialized',
    'target_advanced_after_success'
  )),
  absence_observed_at TIMESTAMPTZ,
  retirement_receipt_sha256 TEXT NOT NULL UNIQUE
    CHECK (retirement_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  retired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (replacement_target_sha <> target_sha),
  CHECK (
    (
      conclusion = 'intent_not_materialized'
      AND workflow_run_id IS NULL
      AND dispatch_receipt_sha256 IS NULL
      AND intent_receipt_sha256 IS NOT NULL
      AND absence_observed_at IS NOT NULL
    ) OR (
      conclusion <> 'intent_not_materialized'
      AND workflow_run_id IS NOT NULL
      AND dispatch_receipt_sha256 IS NOT NULL
      AND absence_observed_at IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_constructor_release_retirements_job
  ON constructor_release_retirements (job_id, retired_at DESC);

COMMIT;
