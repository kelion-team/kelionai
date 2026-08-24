-- One-way removal of the obsolete in-app executable store and its identifying
-- download log. Take and verify a database backup before this migration runs.
-- Application releases belong to a separately signed release boundary.
BEGIN;

DROP TABLE IF EXISTS app_downloads;
DROP TABLE IF EXISTS app_files;

COMMIT;
