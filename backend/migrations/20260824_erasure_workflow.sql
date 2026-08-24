BEGIN;

-- Receipts deliberately contain no email, provider subject or deterministic
-- account hash. The random erasure id is the only link to pseudonymised legal
-- records and cannot be reversed into the former identity.
CREATE TABLE IF NOT EXISTS erasure_requests (
  id UUID PRIMARY KEY,
  erasure_id UUID NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  backup_purge_after TIMESTAMPTZ NOT NULL,
  retention_until TIMESTAMPTZ NOT NULL,
  deleted_categories JSONB NOT NULL DEFAULT '[]',
  retained_records JSONB NOT NULL DEFAULT '[]',
  provider_revocation JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS processor_privacy_actions (
  id BIGSERIAL PRIMARY KEY,
  request_id UUID NOT NULL REFERENCES erasure_requests(id) ON DELETE CASCADE,
  processor TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'manual_required', 'not_applicable')),
  detail_code TEXT NOT NULL DEFAULT '',
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_processor_privacy_actions_request
  ON processor_privacy_actions (request_id, attempted_at);

-- Retained accounting/audit rows carry their basis and scheduled expiry on
-- the row itself; policy text cannot promise a retention period the schema
-- cannot enforce or inspect.
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS legal_basis TEXT;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS erasure_request_id UUID;

ALTER TABLE billing_events ADD COLUMN IF NOT EXISTS legal_basis TEXT;
ALTER TABLE billing_events ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ;
ALTER TABLE billing_events ADD COLUMN IF NOT EXISTS erasure_request_id UUID;

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS legal_basis TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS erasure_request_id UUID;

ALTER TABLE payment_codes ADD COLUMN IF NOT EXISTS legal_basis TEXT;
ALTER TABLE payment_codes ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ;
ALTER TABLE payment_codes ADD COLUMN IF NOT EXISTS erasure_request_id UUID;

ALTER TABLE plati_neatribuite ADD COLUMN IF NOT EXISTS legal_basis TEXT;
ALTER TABLE plati_neatribuite ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ;
ALTER TABLE plati_neatribuite ADD COLUMN IF NOT EXISTS erasure_request_id UUID;

ALTER TABLE cost_events ADD COLUMN IF NOT EXISTS legal_basis TEXT;
ALTER TABLE cost_events ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ;
ALTER TABLE cost_events ADD COLUMN IF NOT EXISTS erasure_request_id UUID;

ALTER TABLE provider_usage_events ADD COLUMN IF NOT EXISTS legal_basis TEXT;
ALTER TABLE provider_usage_events ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ;
ALTER TABLE provider_usage_events ADD COLUMN IF NOT EXISTS erasure_request_id UUID;

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS legal_basis TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS erasure_request_id UUID;

ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS legal_basis TEXT;
ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ;
ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS erasure_request_id UUID;

COMMIT;
