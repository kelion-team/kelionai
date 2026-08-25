-- One canonical work card per Constructor job. Existing authorities remain
-- unchanged: build_jobs owns current execution state, the activity catalog
-- owns the plan, and constructor_activity_events owns transition history.
BEGIN;

CREATE TABLE IF NOT EXISTS constructor_work_cards (
  job_id BIGINT PRIMARY KEY REFERENCES build_jobs(id) ON DELETE CASCADE,
  acceptance_criteria JSONB NOT NULL DEFAULT
    '["Rezultatul cererii este verificat prin dovezi si inchis explicit."]'::jsonb,
  context_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  approvals JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  escalation_condition TEXT NOT NULL DEFAULT
    'Numai o actiune ireversibila a unei autoritati externe; fluxul se reia automat dupa confirmare.',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(acceptance_criteria) = 'array'),
  CHECK (jsonb_typeof(context_links) = 'array'),
  CHECK (jsonb_typeof(decisions) = 'array'),
  CHECK (jsonb_typeof(approvals) = 'array'),
  CHECK (jsonb_typeof(risks) = 'array'),
  CHECK (jsonb_typeof(dependencies) = 'array')
);

INSERT INTO constructor_work_cards (job_id)
SELECT id FROM build_jobs
ON CONFLICT (job_id) DO NOTHING;

CREATE OR REPLACE FUNCTION ensure_constructor_work_card()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO constructor_work_cards (job_id) VALUES (NEW.id)
  ON CONFLICT (job_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_00_constructor_work_card ON build_jobs;
CREATE TRIGGER trg_00_constructor_work_card
AFTER INSERT ON build_jobs FOR EACH ROW EXECUTE FUNCTION ensure_constructor_work_card();

ALTER TABLE constructor_activity_events
  DROP CONSTRAINT IF EXISTS constructor_activity_events_work_card_fkey;
ALTER TABLE constructor_activity_events
  ADD CONSTRAINT constructor_activity_events_work_card_fkey
  FOREIGN KEY (job_id) REFERENCES constructor_work_cards(job_id) ON DELETE CASCADE;

COMMIT;
