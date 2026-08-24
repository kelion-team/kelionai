BEGIN;
SELECT pg_advisory_xact_lock(hashtext('kelion-provider-metering-v1'));

ALTER TABLE provider_usage_events ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE provider_usage_events ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE provider_usage_events ADD COLUMN IF NOT EXISTS service_tier TEXT;
ALTER TABLE provider_usage_events ADD COLUMN IF NOT EXISTS cached_input_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE provider_usage_events ADD COLUMN IF NOT EXISTS reasoning_output_tokens BIGINT NOT NULL DEFAULT 0;
UPDATE provider_usage_events SET model = 'unattributed' WHERE model IS NULL;
ALTER TABLE provider_usage_events ALTER COLUMN model SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_provider_usage_created ON provider_usage_events (created_at DESC);

-- Financial truth is window-level because the official organization Costs API
-- does not attribute invoice amounts to individual response IDs. The worker
-- stores only HMAC-pseudonymous project/key identifiers; no credential or raw
-- organization identifier belongs in the application database.
CREATE TABLE IF NOT EXISTS openai_cost_reconciliation (
  id BIGSERIAL PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  project_id_hash TEXT NOT NULL,
  api_key_id_hash TEXT NOT NULL,
  cost_usd_micros BIGINT NOT NULL CHECK (cost_usd_micros >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  source_fetched_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (window_end > window_start),
  UNIQUE (window_start, window_end, project_id_hash, api_key_id_hash)
);
CREATE INDEX IF NOT EXISTS idx_openai_cost_reconciliation_window
  ON openai_cost_reconciliation (window_start DESC, window_end DESC);

CREATE TABLE IF NOT EXISTS openai_cost_reconciliation_gaps (
  id BIGSERIAL PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  CHECK (window_end > window_start),
  UNIQUE (window_start, window_end, reason)
);
CREATE INDEX IF NOT EXISTS idx_openai_cost_gaps_unresolved
  ON openai_cost_reconciliation_gaps (window_start DESC)
  WHERE resolved_at IS NULL;

COMMIT;
