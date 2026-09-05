-- Current Constructor outcomes must not infer a model identity from the
-- legacy fast/powerful profile. Keep historical rows and catalog keys intact.
BEGIN;

INSERT INTO constructor_activity_catalog
  (activity_key, sequence_no, label_ro, terminal, owner, rationale)
VALUES
  ('unresolved', NULL, 'Constructorul nu a produs un rezultat publicabil', true,
   'codex-worker', 'Cauza masurata ramane in incident; un ciclu nou cere comanda explicita a administratorului')
ON CONFLICT (activity_key) DO NOTHING;

COMMIT;
