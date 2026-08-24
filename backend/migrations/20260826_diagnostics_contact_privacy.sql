BEGIN;

-- Browser diagnostics are non-essential operational data. Historical rows
-- contained full IPs and raw messages with embedded email addresses, so they
-- are removed instead of pretending an incomplete regex anonymised them.
ALTER TABLE client_errors ADD COLUMN account_id UUID;
DELETE FROM client_errors;
ALTER TABLE client_errors DROP COLUMN ip;
CREATE INDEX client_errors_account_recent_idx
  ON client_errors (account_id, created_at DESC);

-- A browser retry after the server stored a contact message must resolve to
-- the same row rather than sending/storing a duplicate.
ALTER TABLE contact_messages ADD COLUMN submission_id UUID;
CREATE UNIQUE INDEX contact_messages_submission_id_unique
  ON contact_messages (submission_id)
  WHERE submission_id IS NOT NULL;

COMMIT;
