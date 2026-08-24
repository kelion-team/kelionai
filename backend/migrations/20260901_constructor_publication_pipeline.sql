-- Constructor publication is a three-identity pipeline:
-- Codex worker -> GitHub publisher -> release dispatcher.  The public web
-- process stores only immutable receipts and short leases; credentials remain
-- in the respective host services.
BEGIN;

CREATE TABLE IF NOT EXISTS constructor_pipeline (
  job_id BIGINT PRIMARY KEY REFERENCES build_jobs(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL UNIQUE,
  handoff_id UUID NOT NULL UNIQUE,
  base_commit_sha TEXT NOT NULL CHECK (base_commit_sha ~ '^[0-9a-f]{40}$'),
  patch_sha256 TEXT NOT NULL CHECK (patch_sha256 ~ '^[0-9a-f]{64}$'),
  gate_receipt_sha256 TEXT NOT NULL CHECK (gate_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  handoff_created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  publisher_attempts INTEGER NOT NULL DEFAULT 0 CHECK (publisher_attempts BETWEEN 0 AND 3),
  publisher_lease_id UUID UNIQUE,
  publisher_lease_until TIMESTAMPTZ,
  publisher_branch TEXT,
  publisher_head_sha TEXT CHECK (publisher_head_sha IS NULL OR publisher_head_sha ~ '^[0-9a-f]{40}$'),
  publisher_pr_number BIGINT CHECK (publisher_pr_number IS NULL OR publisher_pr_number > 0),
  publisher_pr_url TEXT,
  publisher_receipt_sha256 TEXT CHECK (publisher_receipt_sha256 IS NULL OR publisher_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  publisher_last_error TEXT,
  merged_commit_sha TEXT CHECK (merged_commit_sha IS NULL OR merged_commit_sha ~ '^[0-9a-f]{40}$'),

  release_attempts INTEGER NOT NULL DEFAULT 0 CHECK (release_attempts BETWEEN 0 AND 3),
  release_lease_id UUID UNIQUE,
  release_lease_until TIMESTAMPTZ,
  release_request_id UUID UNIQUE,
  release_workflow_run_id BIGINT CHECK (release_workflow_run_id IS NULL OR release_workflow_run_id > 0),
  release_dispatch_receipt_sha256 TEXT CHECK (release_dispatch_receipt_sha256 IS NULL OR release_dispatch_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  release_receipt_sha256 TEXT CHECK (release_receipt_sha256 IS NULL OR release_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  release_last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_constructor_pipeline_publisher_claim
  ON constructor_pipeline (publisher_lease_until, handoff_created_at)
  WHERE merged_commit_sha IS NULL AND publisher_attempts < 3;

CREATE INDEX IF NOT EXISTS idx_constructor_pipeline_release_claim
  ON constructor_pipeline (release_lease_until, updated_at)
  WHERE merged_commit_sha IS NOT NULL AND release_receipt_sha256 IS NULL AND release_attempts < 3;

-- Replay protection must survive application restarts.  Each service has its
-- own namespace and secret; a nonce accepted by one identity cannot be reused
-- by another identity.
CREATE TABLE IF NOT EXISTS constructor_service_nonces (
  service_domain TEXT NOT NULL CHECK (service_domain IN ('codex-worker', 'constructor-publisher', 'constructor-release')),
  nonce UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (service_domain, nonce)
);

CREATE INDEX IF NOT EXISTS idx_constructor_service_nonces_expiry
  ON constructor_service_nonces (expires_at);

COMMIT;
