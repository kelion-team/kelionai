BEGIN;

-- Reporting registration time is distinct from the original event time.
-- Existing history keeps its original boundary; only subsequent inserts use
-- the database wall clock after obtaining the table's write lock. In
-- particular, now() would incorrectly reuse an older transaction's start.
ALTER TABLE messages ADD COLUMN stats_recorded_at TIMESTAMPTZ;
ALTER TABLE cost_events ADD COLUMN stats_recorded_at TIMESTAMPTZ;
UPDATE messages SET stats_recorded_at=created_at;
UPDATE cost_events SET stats_recorded_at=created_at;
ALTER TABLE messages
  ALTER COLUMN stats_recorded_at SET DEFAULT clock_timestamp(),
  ALTER COLUMN stats_recorded_at SET NOT NULL;
ALTER TABLE cost_events
  ALTER COLUMN stats_recorded_at SET DEFAULT clock_timestamp(),
  ALTER COLUMN stats_recorded_at SET NOT NULL;
CREATE INDEX idx_messages_stats_recorded ON messages(stats_recorded_at);
CREATE INDEX idx_cost_events_stats_recorded ON cost_events(stats_recorded_at);
COMMENT ON COLUMN messages.stats_recorded_at IS
  'Database registration time for admin reporting reset; created_at remains original event/offline time';
COMMENT ON COLUMN cost_events.stats_recorded_at IS
  'Database registration time for admin reporting reset; created_at remains original provider event time';

COMMIT;
