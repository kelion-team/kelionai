BEGIN;

DO $cleanup$
DECLARE
  protected_table TEXT;
BEGIN
  FOREACH protected_table IN ARRAY ARRAY[
    'local_accounts', 'google_accounts', 'wallets', 'transactions',
    'billing_events', 'payment_codes', 'voiceprints', 'faceprints',
    'messages', 'audit_log', 'video_invatat'
  ]
  LOOP
    IF to_regclass('public.' || protected_table) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'scut_' || protected_table || '_del', protected_table);
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'scut_' || protected_table || '_trunc', protected_table);
    END IF;
  END LOOP;
END
$cleanup$;

DROP FUNCTION IF EXISTS refuza_stergerea();

COMMIT;
