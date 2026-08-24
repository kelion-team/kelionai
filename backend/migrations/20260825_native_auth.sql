BEGIN;

ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS session_kind TEXT NOT NULL DEFAULT 'browser'
    CHECK (session_kind IN ('browser', 'native'));
ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS device_id UUID;
CREATE INDEX IF NOT EXISTS idx_auth_sessions_device_active
  ON auth_sessions (device_id, expires_at)
  WHERE session_kind = 'native' AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS native_auth_requests (
  id UUID PRIMARY KEY,
  handle_hash TEXT NOT NULL UNIQUE CHECK (handle_hash ~ '^[a-f0-9]{64}$'),
  oauth_state_hash TEXT NOT NULL UNIQUE CHECK (oauth_state_hash ~ '^[a-f0-9]{64}$'),
  client_state TEXT NOT NULL CHECK (client_state ~ '^[A-Za-z0-9_-]{32,128}$'),
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'desktop')),
  install_id UUID NOT NULL,
  client_code_challenge TEXT NOT NULL CHECK (client_code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  google_pkce_cipher TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'consumed')),
  email TEXT,
  name TEXT NOT NULL DEFAULT '',
  picture TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT '',
  exchange_code_hash TEXT UNIQUE CHECK (exchange_code_hash IS NULL OR exchange_code_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  ready_expires_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  CHECK ((status = 'pending' AND email IS NULL AND exchange_code_hash IS NULL)
      OR (status IN ('ready', 'consumed') AND email IS NOT NULL AND exchange_code_hash IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_native_auth_requests_expiry
  ON native_auth_requests (expires_at, ready_expires_at);

CREATE TABLE IF NOT EXISTS native_channel_tickets (
  ticket_hash TEXT PRIMARY KEY CHECK (ticket_hash ~ '^[a-f0-9]{64}$'),
  session_token_hash TEXT NOT NULL REFERENCES auth_sessions(token_hash) ON DELETE CASCADE,
  audience TEXT NOT NULL CHECK (audience IN ('vocal-live', 'apel', 'deploy-status')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_native_channel_tickets_expiry
  ON native_channel_tickets (expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS account_client_storage_ids (
  user_email TEXT PRIMARY KEY,
  storage_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
