-- Non-destructive accounting upgrade. Fresh databases already have the target
-- minor-unit columns from the base schema; legacy databases are backfilled only
-- when the corresponding major-unit column exists. Ambiguous values stop the
-- transaction for explicit reconciliation instead of being rounded.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('kelion-billing-minor-v1'));

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS balance_minor BIGINT;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS topup_ref_minor BIGINT;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'GBP';

ALTER TABLE billing_events ADD COLUMN IF NOT EXISTS amount_minor BIGINT;
ALTER TABLE billing_events ADD COLUMN IF NOT EXISTS currency TEXT;
ALTER TABLE billing_events ADD COLUMN IF NOT EXISTS policy_version TEXT;

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS gross_minor BIGINT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS user_credit_minor BIGINT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS currency TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS policy_version TEXT;

ALTER TABLE cost_events ADD COLUMN IF NOT EXISTS cost_usd_micros BIGINT;

ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS low_credit_reminder_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS low_credit_threshold_minor BIGINT;
ALTER TABLE user_prefs ADD COLUMN IF NOT EXISTS suggested_topup_minor BIGINT;

DO $migration$
DECLARE
  invalid_value BOOLEAN;
BEGIN
  -- Wallets: convert only legacy major-unit columns that really exist.
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'wallets'::regclass AND attname = 'balance' AND NOT attisdropped
  ) THEN
    EXECUTE 'SELECT EXISTS (
      SELECT 1 FROM wallets
       WHERE balance IS NOT NULL AND balance * 100 <> trunc(balance * 100)
    )' INTO invalid_value;
    IF invalid_value THEN
      RAISE EXCEPTION 'wallets.balance contains sub-penny legacy values; reconcile before migration';
    END IF;
    EXECUTE 'UPDATE wallets
                SET balance_minor = (balance * 100)::bigint
              WHERE balance_minor IS NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'wallets'::regclass AND attname = 'topup_ref' AND NOT attisdropped
  ) THEN
    EXECUTE 'SELECT EXISTS (
      SELECT 1 FROM wallets
       WHERE topup_ref IS NOT NULL AND topup_ref * 100 <> trunc(topup_ref * 100)
    )' INTO invalid_value;
    IF invalid_value THEN
      RAISE EXCEPTION 'wallets.topup_ref contains sub-penny legacy values; reconcile before migration';
    END IF;
    EXECUTE 'UPDATE wallets
                SET topup_ref_minor = (topup_ref * 100)::bigint
              WHERE topup_ref_minor IS NULL';
  END IF;

  UPDATE wallets
     SET currency = COALESCE(NULLIF(upper(currency), ''), 'GBP');
  IF EXISTS (SELECT 1 FROM wallets WHERE balance_minor IS NULL OR topup_ref_minor IS NULL) THEN
    RAISE EXCEPTION 'wallet minor-unit backfill is incomplete';
  END IF;

  -- Billing ledger: preserve the legacy column and populate the new ledger
  -- fields only when they have not already been written by a fresh schema.
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'billing_events'::regclass AND attname = 'amount' AND NOT attisdropped
  ) THEN
    EXECUTE 'SELECT EXISTS (
      SELECT 1 FROM billing_events
       WHERE amount IS NOT NULL AND amount * 100 <> trunc(amount * 100)
    )' INTO invalid_value;
    IF invalid_value THEN
      RAISE EXCEPTION 'billing_events.amount contains sub-penny legacy values; reconcile before migration';
    END IF;
    EXECUTE 'UPDATE billing_events
                SET amount_minor = (amount * 100)::bigint
              WHERE amount_minor IS NULL';
  END IF;

  UPDATE billing_events
     SET currency = COALESCE(NULLIF(upper(currency), ''), 'GBP'),
         policy_version = COALESCE(NULLIF(policy_version, ''), 'legacy-gbp-import-v1');
  IF EXISTS (SELECT 1 FROM billing_events WHERE amount_minor IS NULL) THEN
    RAISE EXCEPTION 'billing event minor-unit backfill is incomplete';
  END IF;

  -- A legacy paid purchase is eligible only when the gross penny amount can
  -- be split exactly. Pending/failed rows have not granted product credit.
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'transactions'::regclass AND attname = 'amount' AND NOT attisdropped
  ) THEN
    EXECUTE 'SELECT EXISTS (
      SELECT 1 FROM transactions
       WHERE amount IS NOT NULL AND amount * 100 <> trunc(amount * 100)
    )' INTO invalid_value;
    IF invalid_value THEN
      RAISE EXCEPTION 'transactions.amount contains sub-penny legacy values; reconcile before migration';
    END IF;
    EXECUTE 'SELECT EXISTS (
      SELECT 1 FROM transactions
       WHERE lower(status) = ''paid'' AND ((amount * 100)::bigint % 4) <> 0
    )' INTO invalid_value;
    IF invalid_value THEN
      RAISE EXCEPTION 'paid transaction cannot be split exactly 75/25; reconcile before migration';
    END IF;
    EXECUTE 'UPDATE transactions
                SET gross_minor = COALESCE(gross_minor, (amount * 100)::bigint),
                    user_credit_minor = COALESCE(user_credit_minor, CASE
                      WHEN lower(status) = ''paid'' THEN ((amount * 100)::bigint * 3 / 4)
                      ELSE 0
                    END)
              WHERE gross_minor IS NULL OR user_credit_minor IS NULL';
  END IF;

  UPDATE transactions
     SET currency = COALESCE(NULLIF(upper(currency), ''), 'GBP'),
         policy_version = COALESCE(NULLIF(policy_version, ''), 'legacy-gbp-import-v1');
  IF EXISTS (
    SELECT 1 FROM transactions
     WHERE gross_minor IS NULL OR user_credit_minor IS NULL
  ) THEN
    RAISE EXCEPTION 'transaction minor-unit backfill is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM transactions
     WHERE lower(status) = 'paid'
       AND (gross_minor % 4 <> 0 OR user_credit_minor * 4 <> gross_minor * 3)
  ) THEN
    RAISE EXCEPTION 'paid transaction violates exact 75/25 policy';
  END IF;

  -- Provider expense is a separate USD-micros ledger. Legacy values with more
  -- than six decimal places require reconciliation rather than rounding.
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'cost_events'::regclass AND attname = 'cost_usd' AND NOT attisdropped
  ) THEN
    EXECUTE 'SELECT EXISTS (
      SELECT 1 FROM cost_events
       WHERE cost_usd IS NOT NULL
         AND cost_usd::numeric * 1000000 <> trunc(cost_usd::numeric * 1000000)
    )' INTO invalid_value;
    IF invalid_value THEN
      RAISE EXCEPTION 'cost_events.cost_usd contains sub-micro legacy values; reconcile before migration';
    END IF;
    EXECUTE 'UPDATE cost_events
                SET cost_usd_micros = (cost_usd::numeric * 1000000)::bigint
              WHERE cost_usd_micros IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM cost_events WHERE cost_usd_micros IS NULL) THEN
    RAISE EXCEPTION 'provider-cost micro-unit backfill is incomplete';
  END IF;

  -- Legacy "autorecharge" was only a reminder. Keep its meaning, but never
  -- invent a threshold conversion from unsnapshotted historical credit value.
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'user_prefs'::regclass AND attname = 'autorecharge_enabled' AND NOT attisdropped
  ) THEN
    EXECUTE 'UPDATE user_prefs
                SET low_credit_reminder_enabled = COALESCE(autorecharge_enabled, false)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'user_prefs'::regclass AND attname = 'autorecharge_amount' AND NOT attisdropped
  ) THEN
    EXECUTE 'SELECT EXISTS (
      SELECT 1 FROM user_prefs
       WHERE autorecharge_amount IS NOT NULL
         AND autorecharge_amount * 100 <> trunc(autorecharge_amount * 100)
    )' INTO invalid_value;
    IF invalid_value THEN
      RAISE EXCEPTION 'user_prefs.autorecharge_amount contains sub-penny legacy values';
    END IF;
    EXECUTE 'UPDATE user_prefs
                SET suggested_topup_minor = (autorecharge_amount * 100)::bigint
              WHERE suggested_topup_minor IS NULL AND autorecharge_amount IS NOT NULL';
  END IF;
END
$migration$;

ALTER TABLE wallets ALTER COLUMN balance_minor SET DEFAULT 0;
ALTER TABLE wallets ALTER COLUMN balance_minor SET NOT NULL;
ALTER TABLE wallets ALTER COLUMN topup_ref_minor SET DEFAULT 0;
ALTER TABLE wallets ALTER COLUMN topup_ref_minor SET NOT NULL;

ALTER TABLE billing_events ALTER COLUMN amount_minor SET NOT NULL;
ALTER TABLE billing_events ALTER COLUMN currency SET DEFAULT 'GBP';
ALTER TABLE billing_events ALTER COLUMN currency SET NOT NULL;
ALTER TABLE billing_events ALTER COLUMN policy_version SET NOT NULL;

ALTER TABLE transactions ALTER COLUMN gross_minor SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN user_credit_minor SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN currency SET DEFAULT 'GBP';
ALTER TABLE transactions ALTER COLUMN currency SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN policy_version SET NOT NULL;

ALTER TABLE cost_events ALTER COLUMN cost_usd_micros SET NOT NULL;

COMMIT;
