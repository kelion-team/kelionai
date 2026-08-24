BEGIN;

CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  checksum_sha256 TEXT NOT NULL CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
