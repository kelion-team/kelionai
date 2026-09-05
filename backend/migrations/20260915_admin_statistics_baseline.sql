-- Reset is a new reporting boundary, never deletion of historical evidence.
BEGIN;

CREATE TABLE admin_stats_baselines (
  id BIGSERIAL PRIMARY KEY,
  stats_since TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO admin_stats_baselines(stats_since) VALUES (NULL);
CREATE TABLE admin_stats_presence_baseline (
  baseline_id BIGINT NOT NULL REFERENCES admin_stats_baselines(id),
  user_email TEXT NOT NULL,
  day DATE NOT NULL,
  actions BIGINT NOT NULL,
  PRIMARY KEY(baseline_id,user_email,day),
  FOREIGN KEY(user_email,day) REFERENCES user_presence_daily(user_email,day) ON DELETE CASCADE
);
CREATE TABLE admin_stats_visits_baseline (
  baseline_id BIGINT NOT NULL REFERENCES admin_stats_baselines(id),
  day DATE NOT NULL,
  path TEXT NOT NULL,
  country_code TEXT NOT NULL,
  views BIGINT NOT NULL,
  PRIMARY KEY(baseline_id,day,path,country_code),
  FOREIGN KEY(day,path,country_code) REFERENCES visit_daily(day,path,country_code) ON DELETE CASCADE
);

CREATE FUNCTION admin_presence_since(reset_id BIGINT)
RETURNS TABLE(user_email TEXT,day DATE,sessions BIGINT,seconds DOUBLE PRECISION,actions BIGINT,last_seen_at TIMESTAMPTZ)
LANGUAGE SQL STABLE AS $$
 SELECT v.user_email,v.day,
   CASE WHEN s.stats_since IS NULL OR v.last_seen_at>s.stats_since THEN 1 ELSE 0 END::bigint,
   greatest(0,extract(epoch FROM v.last_seen_at-greatest(v.first_seen_at,coalesce(s.stats_since,v.first_seen_at))))::double precision,
   CASE WHEN s.stats_since IS NULL OR v.day>=s.stats_since::date
     THEN greatest(0,v.actions-coalesce(b.actions,0)) ELSE 0 END,
   v.last_seen_at
 FROM user_presence_daily v CROSS JOIN admin_stats_baselines s
 LEFT JOIN admin_stats_presence_baseline b ON b.baseline_id=s.id AND b.user_email=v.user_email AND b.day=v.day
 WHERE s.id=reset_id
$$;

CREATE FUNCTION admin_visits_since(reset_id BIGINT)
RETURNS TABLE(day DATE,path TEXT,country_code TEXT,views BIGINT,last_seen_at TIMESTAMPTZ)
LANGUAGE SQL STABLE AS $$
 SELECT v.day,v.path,v.country_code,
   CASE WHEN s.stats_since IS NULL OR v.day>=s.stats_since::date
     THEN greatest(0,v.views-coalesce(b.views,0)) ELSE 0 END,v.last_seen_at
 FROM visit_daily v CROSS JOIN admin_stats_baselines s
 LEFT JOIN admin_stats_visits_baseline b ON b.baseline_id=s.id AND b.day=v.day AND b.path=v.path AND b.country_code=v.country_code
 WHERE s.id=reset_id
$$;

COMMIT;
