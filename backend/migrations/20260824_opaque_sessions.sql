BEGIN;

-- Opaque, revocable, server-side browser sessions. The browser stores only a
-- random handle; OAuth credentials remain in the encrypted account store.
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  picture TEXT NOT NULL DEFAULT '',
  auth_provider TEXT NOT NULL CHECK (auth_provider IN ('google', 'local')),
  locale TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_email_active
  ON auth_sessions (email, expires_at)
  WHERE revoked_at IS NULL;

-- Existing plaintext refresh tokens are intentionally not trusted by the new
-- runtime. Users reconnect once; the replacement is AES-GCM ciphertext.
ALTER TABLE google_accounts
  ADD COLUMN IF NOT EXISTS granted_scopes TEXT[] NOT NULL DEFAULT '{}';

COMMIT;
