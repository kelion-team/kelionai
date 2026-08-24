-- Durable ownership and terminal replay for chat retries.
-- Only the visible assistant text is retained for seven days; raw audio, tool
-- payloads and provider reasoning never enter this table. The UUID/hash
-- tombstone remains until account erasure so a late retry cannot re-execute.

BEGIN;

CREATE TABLE IF NOT EXISTS chat_turn_replays (
  user_email TEXT NOT NULL CHECK (user_email = lower(user_email) AND length(user_email) BETWEEN 3 AND 320),
  idempotency_key UUID NOT NULL,
  request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  turn_id UUID NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running', 'completed', 'failed', 'indeterminate')),
  lease_token UUID NOT NULL,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  side_effect_started BOOLEAN NOT NULL DEFAULT FALSE,
  result_text TEXT NULL CHECK (result_text IS NULL OR octet_length(result_text) <= 262144),
  terminal_code TEXT NULL CHECK (terminal_code IS NULL OR length(terminal_code) <= 80),
  terminal_http_status SMALLINT NULL CHECK (terminal_http_status IS NULL OR terminal_http_status BETWEEN 200 AND 599),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Expiry of result_text replay, not expiry of the idempotency tombstone.
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  PRIMARY KEY (user_email, idempotency_key),
  UNIQUE (user_email, turn_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_turn_replays_expiry
  ON chat_turn_replays (expires_at);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS chat_request_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_messages_user_chat_request_role
  ON messages (lower(user_email), chat_request_id, role)
  WHERE chat_request_id IS NOT NULL;

COMMIT;
