BEGIN;

ALTER TABLE native_auth_requests
  DROP CONSTRAINT IF EXISTS native_auth_requests_platform_check;

ALTER TABLE native_auth_requests
  ADD CONSTRAINT native_auth_requests_platform_check
  CHECK (platform IN ('ios', 'desktop', 'constructor-desktop'));

COMMIT;
