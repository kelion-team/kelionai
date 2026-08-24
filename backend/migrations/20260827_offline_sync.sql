BEGIN;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_event_id UUID;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_created_at_ms BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_messages_user_client_event
  ON messages (lower(user_email), client_event_id)
  WHERE client_event_id IS NOT NULL;

COMMIT;
