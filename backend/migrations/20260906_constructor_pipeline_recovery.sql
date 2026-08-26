-- Recovery policy for the publisher/release legs. Attempts are diagnostic,
-- never a terminal budget. Every retry has a durable deadline, and a failed
-- publication attempt is retained after its GitHub artifacts are retired.
BEGIN;

ALTER TABLE constructor_pipeline
  DROP CONSTRAINT IF EXISTS constructor_pipeline_publisher_attempts_check,
  DROP CONSTRAINT IF EXISTS constructor_pipeline_release_attempts_check;

ALTER TABLE constructor_pipeline
  ADD CONSTRAINT constructor_pipeline_publisher_attempts_nonnegative
    CHECK (publisher_attempts >= 0),
  ADD CONSTRAINT constructor_pipeline_release_attempts_nonnegative
    CHECK (release_attempts >= 0),
  ADD COLUMN IF NOT EXISTS publisher_retry_not_before TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS release_retry_not_before TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS release_target_sha TEXT
    CHECK (release_target_sha IS NULL OR release_target_sha ~ '^[0-9a-f]{40}$'),
  ADD COLUMN IF NOT EXISTS release_target_receipt_sha256 TEXT
    CHECK (release_target_receipt_sha256 IS NULL OR release_target_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS release_ci_run_id BIGINT
    CHECK (release_ci_run_id IS NULL OR release_ci_run_id > 0),
  ADD COLUMN IF NOT EXISTS release_build_run_id BIGINT
    CHECK (release_build_run_id IS NULL OR release_build_run_id > 0),
  ADD COLUMN IF NOT EXISTS release_artifact_id BIGINT
    CHECK (release_artifact_id IS NULL OR release_artifact_id > 0),
  ADD COLUMN IF NOT EXISTS release_candidate_receipt_sha256 TEXT
    CHECK (release_candidate_receipt_sha256 IS NULL OR release_candidate_receipt_sha256 ~ '^[0-9a-f]{64}$');

DROP INDEX IF EXISTS idx_constructor_pipeline_publisher_claim;
CREATE INDEX idx_constructor_pipeline_publisher_claim
  ON constructor_pipeline (publisher_retry_not_before, publisher_lease_until, handoff_created_at)
  WHERE merged_commit_sha IS NULL;

DROP INDEX IF EXISTS idx_constructor_pipeline_release_claim;
CREATE INDEX idx_constructor_pipeline_release_claim
  ON constructor_pipeline (release_retry_not_before, release_lease_until, updated_at)
  WHERE merged_commit_sha IS NOT NULL AND release_receipt_sha256 IS NULL;

CREATE TABLE IF NOT EXISTS constructor_publication_retirements (
  id BIGSERIAL PRIMARY KEY,
  -- Evidence remains durable even if an administrator later removes the
  -- presentation row from build_jobs. A cleanup receipt must never disappear
  -- through a cascading history deletion.
  job_id BIGINT NOT NULL,
  task_id TEXT NOT NULL,
  handoff_id UUID NOT NULL,
  branch TEXT,
  head_sha TEXT CHECK (head_sha IS NULL OR head_sha ~ '^[0-9a-f]{40}$'),
  pr_number BIGINT CHECK (pr_number IS NULL OR pr_number > 0),
  failure_code TEXT NOT NULL,
  cleanup_receipt_sha256 TEXT NOT NULL UNIQUE
    CHECK (cleanup_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  retired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_constructor_publication_retirements_job
  ON constructor_publication_retirements (job_id, retired_at DESC);

COMMIT;
