-- Explicit, one-way privacy migration. Review and back up before applying.
-- It discards legacy per-visitor IP/device/photo/fingerprint data. Anonymous
-- rows become non-identifying daily totals. Signed-in rows become a separate,
-- explicitly account-scoped daily presence record; that table is personal
-- data and is covered by account erasure/retention, never described as
-- anonymous. Runtime code never runs this file automatically.
BEGIN;

DO $privacy$
BEGIN
  IF to_regclass('public.visits') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO visit_daily (day, path, country_code, views, last_seen_at)
      SELECT started_at::date,
             '/'::text,
             CASE
               WHEN upper(country_code) ~ '^[A-Z]{2}$'
                 AND upper(country_code) NOT IN ('XX', 'T1')
               THEN upper(country_code)
               ELSE ''
             END,
             COUNT(*)::bigint,
             MAX(COALESCE(last_seen_at, started_at))
        FROM visits
       GROUP BY started_at::date,
                CASE
                  WHEN upper(country_code) ~ '^[A-Z]{2}$'
                    AND upper(country_code) NOT IN ('XX', 'T1')
                  THEN upper(country_code)
                  ELSE ''
                END
      ON CONFLICT (day, path, country_code) DO UPDATE SET
        views = visit_daily.views + EXCLUDED.views,
        last_seen_at = GREATEST(visit_daily.last_seen_at, EXCLUDED.last_seen_at)
    $sql$;

    EXECUTE $sql$
      INSERT INTO user_presence_daily
        (user_email, day, first_seen_at, last_seen_at, actions, pages)
      SELECT lower(user_email), started_at::date, MIN(started_at),
             MAX(COALESCE(last_seen_at, started_at)), SUM(actions)::bigint, '{}'
        FROM visits
       WHERE user_email <> ''
       GROUP BY lower(user_email), started_at::date
      ON CONFLICT (user_email, day) DO UPDATE SET
        first_seen_at = LEAST(user_presence_daily.first_seen_at, EXCLUDED.first_seen_at),
        last_seen_at = GREATEST(user_presence_daily.last_seen_at, EXCLUDED.last_seen_at),
        actions = user_presence_daily.actions + EXCLUDED.actions
    $sql$;

    DROP TABLE visits;
  END IF;

  IF to_regclass('public.demo_uses') IS NOT NULL THEN
    DROP TABLE demo_uses;
  END IF;
END
$privacy$;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS submission_session UUID;
ALTER TABLE leads DROP COLUMN IF EXISTS fp;

COMMIT;
