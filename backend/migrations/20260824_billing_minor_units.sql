-- Non-destructive accounting upgrade. Fresh databases already have the target
-- minor-unit columns from the base schema. Legacy major-unit values remain in
-- place as audit evidence while deterministic integer projections are added.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('kelion-billing-minor-v1'));

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS balance_minor BIGINT;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS topup_ref_minor BIGINT;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS debt_minor BIGINT;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS frozen_reason TEXT;
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
  -- Wallets represent current state rather than an append-only ledger. Round
  -- the legacy snapshot once. A negative snapshot becomes explicit debt and
  -- freezes spending; it must never survive as a negative usable balance.
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'wallets'::regclass AND attname = 'balance' AND NOT attisdropped
  ) THEN
    EXECUTE $sql$
      UPDATE wallets
         SET balance_minor = round(balance * 100)::bigint
       WHERE balance_minor IS NULL
    $sql$;
  END IF;

  UPDATE wallets
     SET debt_minor = COALESCE(debt_minor, 0) + abs(balance_minor),
         balance_minor = 0,
         frozen_reason = COALESCE(NULLIF(frozen_reason, ''), 'legacy_debt_reconciliation')
   WHERE balance_minor < 0;

  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'wallets'::regclass AND attname = 'topup_ref' AND NOT attisdropped
  ) THEN
    EXECUTE $sql$
      UPDATE wallets
         SET topup_ref_minor = round(topup_ref * 100)::bigint
       WHERE topup_ref_minor IS NULL
    $sql$;
  END IF;

  UPDATE wallets
     SET balance_minor = COALESCE(balance_minor, 0),
         topup_ref_minor = COALESCE(topup_ref_minor, 0),
         debt_minor = COALESCE(debt_minor, 0),
         currency = COALESCE(NULLIF(upper(currency), ''), 'GBP');

  IF EXISTS (
    SELECT 1 FROM wallets
     WHERE balance_minor < 0 OR topup_ref_minor < 0 OR debt_minor < 0
  ) THEN
    RAISE EXCEPTION 'wallet minor-unit reconciliation produced a negative stored unit';
  END IF;

  -- Usage contains repeating fractional prices. Allocate the rounded group
  -- total deterministically by row: rounded running total minus its preceding
  -- rounded running total, partitioned by normalized user and event kind.
  -- This preserves every legacy row and exactly preserves the rounded sum.
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'billing_events'::regclass AND attname = 'amount' AND NOT attisdropped
  ) THEN
    EXECUTE $sql$
      WITH running AS (
        SELECT id,
               lower(user_email) AS user_key,
               kind,
               created_at,
               round(
                 sum(amount) OVER (
                   PARTITION BY lower(user_email), kind
                   ORDER BY created_at, id
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                 ) * 100
               )::bigint AS running_minor
          FROM billing_events
         WHERE amount IS NOT NULL AND kind = 'usage'
      ), allocated AS (
        SELECT id,
               running_minor - COALESCE(
                 lag(running_minor) OVER (
                   PARTITION BY user_key, kind ORDER BY created_at, id
                 ),
                 0
               ) AS expected_minor
          FROM running
      )
      UPDATE billing_events AS event
         SET amount_minor = allocated.expected_minor
        FROM allocated
       WHERE event.id = allocated.id AND event.amount_minor IS NULL
    $sql$;

    -- Non-usage events are independent commercial facts. Customer topup share
    -- is floored and Kelion profit is ceiled, so an odd penny cannot migrate
    -- from the required minimum 25% remainder into customer credit.
    -- Legacy refunds were stored as positive magnitudes but the new signed
    -- ledger contract debits them, hence their deterministic negative sign.
    EXECUTE $sql$
      UPDATE billing_events
         SET amount_minor = CASE
               WHEN kind = 'refund' THEN -abs(round(amount * 100)::bigint)
               WHEN kind = 'topup' THEN floor(amount * 100)::bigint
               WHEN kind IN ('profit', 'margin') THEN ceil(amount * 100)::bigint
               ELSE round(amount * 100)::bigint
             END
       WHERE amount_minor IS NULL AND amount IS NOT NULL AND kind <> 'usage'
    $sql$;

    EXECUTE $sql$
      SELECT EXISTS (
        SELECT 1
          FROM (
            SELECT lower(user_email) AS user_key,
                   kind,
                   round(sum(amount) * 100)::bigint AS expected_minor
              FROM billing_events
             WHERE amount IS NOT NULL AND kind = 'usage'
             GROUP BY lower(user_email), kind
          ) AS legacy
          JOIN (
            SELECT lower(user_email) AS user_key,
                   kind,
                   sum(amount_minor)::bigint AS actual_minor
              FROM billing_events
             WHERE kind = 'usage'
             GROUP BY lower(user_email), kind
          ) AS projected USING (user_key, kind)
         WHERE projected.actual_minor <> legacy.expected_minor
      )
    $sql$ INTO invalid_value;
    IF invalid_value THEN
      RAISE EXCEPTION 'usage reconciliation does not preserve a rounded per-user/kind sum';
    END IF;

    -- The legacy value is an immutable cutover snapshot. New code writes only
    -- amount_minor, so the retired column must no longer reject current rows.
    EXECUTE 'ALTER TABLE billing_events ALTER COLUMN amount DROP NOT NULL';
  END IF;

  UPDATE billing_events
     SET currency = COALESCE(NULLIF(upper(currency), ''), 'GBP'),
         policy_version = COALESCE(NULLIF(policy_version, ''), 'legacy-gbp-reconciled-v1');
  IF EXISTS (SELECT 1 FROM billing_events WHERE amount_minor IS NULL) THEN
    RAISE EXCEPTION 'billing event minor-unit backfill is incomplete';
  END IF;

  -- The spendable wallet must equal the converted customer ledger, not a
  -- second rounding of the legacy snapshot. In particular, two GBP 9.99
  -- purchases remain 749p + 749p of customer credit; the unallocatable legacy
  -- fraction stays visible only in the untouched major-unit audit column.
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'wallets'::regclass AND attname = 'balance' AND NOT attisdropped
  ) AND EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'billing_events'::regclass AND attname = 'amount' AND NOT attisdropped
  ) THEN
    EXECUTE $sql$
      WITH ledger AS (
        SELECT lower(user_email) AS user_key,
               sum(amount_minor) FILTER (
                 WHERE kind IN ('topup', 'usage', 'refund', 'grant')
               )::bigint AS net_minor
          FROM billing_events
         GROUP BY lower(user_email)
      ), projected AS (
        SELECT wallet.user_email,
               COALESCE(ledger.net_minor, 0)::bigint AS net_minor
          FROM wallets AS wallet
          LEFT JOIN ledger ON ledger.user_key = lower(wallet.user_email)
      )
      UPDATE wallets AS wallet
         SET balance_minor = greatest(projected.net_minor, 0),
             debt_minor = greatest(-projected.net_minor, 0),
             frozen_reason = CASE
               WHEN projected.net_minor < 0 THEN COALESCE(
                 NULLIF(wallet.frozen_reason, ''),
                 'legacy_debt_reconciliation'
               )
               WHEN wallet.frozen_reason = 'legacy_debt_reconciliation' THEN NULL
               ELSE wallet.frozen_reason
             END
        FROM projected
       WHERE wallet.user_email = projected.user_email
    $sql$;
  END IF;

  -- Gross payment is an exact bank fact and is therefore never rounded. Paid
  -- and already-refunded purchases receive floor(75%); Kelion owns the exact
  -- remainder (gross - user credit), including the odd penny when necessary.
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'transactions'::regclass AND attname = 'amount' AND NOT attisdropped
  ) THEN
    EXECUTE $sql$
      SELECT EXISTS (
        SELECT 1 FROM transactions
         WHERE amount IS NOT NULL AND amount * 100 <> trunc(amount * 100)
      )
    $sql$ INTO invalid_value;
    IF invalid_value THEN
      RAISE EXCEPTION 'transactions.amount contains sub-penny legacy values; reconcile before migration';
    END IF;

    EXECUTE $sql$
      UPDATE transactions
         SET gross_minor = COALESCE(gross_minor, (amount * 100)::bigint),
             user_credit_minor = COALESCE(user_credit_minor, CASE
               WHEN lower(status) IN ('paid', 'refunded')
                 THEN floor(((amount * 100)::numeric * 3) / 4)::bigint
               ELSE 0
             END)
       WHERE gross_minor IS NULL OR user_credit_minor IS NULL
    $sql$;

    EXECUTE 'ALTER TABLE transactions ALTER COLUMN amount DROP NOT NULL';

    -- The legacy image uses ON CONFLICT (payment_ref), which PostgreSQL cannot
    -- infer from the old partial unique index. Replace only that index with a
    -- standard UNIQUE constraint (multiple NULLs remain valid) so an immediate
    -- image rollback can settle/idempotently replay a purchase after COMMIT.
    IF EXISTS (
      SELECT 1
        FROM pg_class AS index_relation
        JOIN pg_index AS index_meta ON index_meta.indexrelid = index_relation.oid
       WHERE index_relation.relnamespace = 'public'::regnamespace
         AND index_relation.relname = 'uniq_transactions_ref'
         AND index_meta.indrelid = 'transactions'::regclass
         AND index_meta.indpred IS NOT NULL
    ) THEN
      EXECUTE 'DROP INDEX public.uniq_transactions_ref';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = 'transactions'::regclass
         AND conname = 'uniq_transactions_ref'
         AND contype = 'u'
    ) THEN
      ALTER TABLE transactions
        ADD CONSTRAINT uniq_transactions_ref UNIQUE (payment_ref);
    END IF;
  END IF;

  UPDATE transactions
     SET currency = COALESCE(NULLIF(upper(currency), ''), 'GBP'),
         policy_version = COALESCE(NULLIF(policy_version, ''), 'legacy-gbp-reconciled-v1');
  IF EXISTS (
    SELECT 1 FROM transactions
     WHERE gross_minor IS NULL OR user_credit_minor IS NULL
  ) THEN
    RAISE EXCEPTION 'transaction minor-unit backfill is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM transactions
     WHERE gross_minor < 0 OR user_credit_minor < 0 OR user_credit_minor > gross_minor
       OR (
         lower(status) IN ('paid', 'refunded')
         AND user_credit_minor <> floor((gross_minor::numeric * 3) / 4)::bigint
       )
       OR (lower(status) NOT IN ('paid', 'refunded') AND user_credit_minor <> 0)
  ) THEN
    RAISE EXCEPTION 'transaction violates deterministic legacy 75/25 reconciliation';
  END IF;

  -- Provider expenses can contain real sub-micro fractions (for example a
  -- per-second voice tariff). Use the same cumulative allocation strategy in
  -- USD micros so each per-user/kind rounded aggregate is preserved exactly.
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'cost_events'::regclass AND attname = 'cost_usd' AND NOT attisdropped
  ) THEN
    EXECUTE $sql$
      SELECT EXISTS (SELECT 1 FROM cost_events WHERE cost_usd < 0)
    $sql$ INTO invalid_value;
    IF invalid_value THEN
      RAISE EXCEPTION 'cost_events.cost_usd contains a negative legacy value';
    END IF;

    EXECUTE $sql$
      WITH running AS (
        SELECT id,
               lower(user_email) AS user_key,
               kind,
               created_at,
               round(
                 sum(cost_usd::numeric) OVER (
                   PARTITION BY lower(user_email), kind
                   ORDER BY created_at, id
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                 ) * 1000000
               )::bigint AS running_micros
          FROM cost_events
         WHERE cost_usd IS NOT NULL
      ), allocated AS (
        SELECT id,
               running_micros - COALESCE(
                 lag(running_micros) OVER (
                   PARTITION BY user_key, kind ORDER BY created_at, id
                 ),
                 0
               ) AS expected_micros
          FROM running
      )
      UPDATE cost_events AS event
         SET cost_usd_micros = allocated.expected_micros
        FROM allocated
       WHERE event.id = allocated.id AND event.cost_usd_micros IS NULL
    $sql$;

    EXECUTE $sql$
      SELECT EXISTS (
        SELECT 1
          FROM (
            SELECT lower(user_email) AS user_key,
                   kind,
                   round(sum(cost_usd::numeric) * 1000000)::bigint AS expected_micros
              FROM cost_events
             WHERE cost_usd IS NOT NULL
             GROUP BY lower(user_email), kind
          ) AS legacy
          JOIN (
            SELECT lower(user_email) AS user_key,
                   kind,
                   sum(cost_usd_micros)::bigint AS actual_micros
              FROM cost_events
             GROUP BY lower(user_email), kind
          ) AS projected USING (user_key, kind)
         WHERE projected.actual_micros <> legacy.expected_micros
      )
    $sql$ INTO invalid_value;
    IF invalid_value THEN
      RAISE EXCEPTION 'provider-cost reconciliation does not preserve a rounded per-user/kind sum';
    END IF;
    EXECUTE 'ALTER TABLE cost_events ALTER COLUMN cost_usd DROP NOT NULL';
  END IF;
  IF EXISTS (
    SELECT 1 FROM cost_events WHERE cost_usd_micros IS NULL OR cost_usd_micros < 0
  ) THEN
    RAISE EXCEPTION 'provider-cost micro-unit backfill is incomplete or negative';
  END IF;

  -- Legacy "autorecharge" was only a reminder. Keep its meaning, but never
  -- invent a threshold conversion from unsnapshotted historical credit value.
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'user_prefs'::regclass AND attname = 'autorecharge_enabled' AND NOT attisdropped
  ) THEN
    EXECUTE $sql$
      UPDATE user_prefs
         SET low_credit_reminder_enabled = COALESCE(autorecharge_enabled, false)
    $sql$;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'user_prefs'::regclass AND attname = 'autorecharge_amount' AND NOT attisdropped
  ) THEN
    EXECUTE $sql$
      SELECT EXISTS (
        SELECT 1 FROM user_prefs
         WHERE autorecharge_amount IS NOT NULL
           AND autorecharge_amount * 100 <> trunc(autorecharge_amount * 100)
      )
    $sql$ INTO invalid_value;
    IF invalid_value THEN
      RAISE EXCEPTION 'user_prefs.autorecharge_amount contains sub-penny legacy values';
    END IF;
    EXECUTE $sql$
      UPDATE user_prefs
         SET suggested_topup_minor = (autorecharge_amount * 100)::bigint
       WHERE suggested_topup_minor IS NULL AND autorecharge_amount IS NOT NULL
    $sql$;
  END IF;
END
$migration$;

-- The migration and the application image cannot switch at the same CPU
-- instruction. On an upgraded legacy database these bridges keep the old
-- major-unit writer and the new minor-unit writer mutually readable during
-- the deploy/rollback window. Fresh schemas never receive these triggers.
DO $compatibility$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'wallets'::regclass AND attname = 'balance' AND NOT attisdropped
  ) AND EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'billing_events'::regclass AND attname = 'amount' AND NOT attisdropped
  ) THEN
    EXECUTE $definition$
      CREATE OR REPLACE FUNCTION public.kelion_legacy_wallet_ledger_minor(p_user_email TEXT)
      RETURNS BIGINT
      LANGUAGE sql
      STABLE
      SET search_path = public, pg_temp
      AS $function$
        SELECT COALESCE(
          sum(amount_minor) FILTER (
            WHERE kind IN ('topup', 'usage', 'refund', 'grant')
          ),
          0
        )::bigint
          FROM billing_events
         WHERE lower(user_email) = lower(p_user_email)
      $function$
    $definition$;

    EXECUTE $definition$
      CREATE OR REPLACE FUNCTION public.kelion_legacy_wallet_bridge()
      RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = public, pg_temp
      AS $function$
      DECLARE
        ledger_minor BIGINT;
        legacy_changed BOOLEAN;
        minor_changed BOOLEAN;
      BEGIN
        NEW.currency := COALESCE(NULLIF(upper(NEW.currency), ''), 'GBP');

        -- The ledger bridge updates minor fields internally but deliberately
        -- leaves the old exact snapshot for the legacy request to finish.
        IF current_setting('kelion.compat_internal_wallet_sync', true) = 'on' THEN
          RETURN NEW;
        END IF;

        IF TG_OP = 'INSERT' THEN
          IF COALESCE(NEW.balance_minor, 0) <> 0
             OR COALESCE(NEW.debt_minor, 0) <> 0
             OR COALESCE(NEW.topup_ref_minor, 0) <> 0 THEN
            NEW.balance := (
              COALESCE(NEW.balance_minor, 0) - COALESCE(NEW.debt_minor, 0)
            )::numeric / 100;
            NEW.topup_ref := COALESCE(NEW.topup_ref_minor, 0)::numeric / 100;
          ELSE
            ledger_minor := public.kelion_legacy_wallet_ledger_minor(NEW.user_email);
            NEW.balance_minor := greatest(ledger_minor, 0);
            NEW.debt_minor := greatest(-ledger_minor, 0);
            NEW.topup_ref_minor := round(COALESCE(NEW.topup_ref, 0) * 100)::bigint;
            NEW.frozen_reason := CASE
              WHEN ledger_minor < 0 THEN COALESCE(
                NULLIF(NEW.frozen_reason, ''),
                'legacy_debt_reconciliation'
              )
              WHEN NEW.frozen_reason = 'legacy_debt_reconciliation' THEN NULL
              ELSE NEW.frozen_reason
            END;
          END IF;
          RETURN NEW;
        END IF;

        legacy_changed := NEW.balance IS DISTINCT FROM OLD.balance
          OR NEW.topup_ref IS DISTINCT FROM OLD.topup_ref;
        minor_changed := NEW.balance_minor IS DISTINCT FROM OLD.balance_minor
          OR NEW.debt_minor IS DISTINCT FROM OLD.debt_minor
          OR NEW.topup_ref_minor IS DISTINCT FROM OLD.topup_ref_minor;

        IF legacy_changed AND NOT minor_changed THEN
          -- An old app write cannot mint a rounding penny. The converted
          -- customer ledger remains authoritative; a following legacy event
          -- trigger completes the update in the same transaction when used.
          ledger_minor := public.kelion_legacy_wallet_ledger_minor(NEW.user_email);
          NEW.balance_minor := greatest(ledger_minor, 0);
          NEW.debt_minor := greatest(-ledger_minor, 0);
          NEW.topup_ref_minor := round(COALESCE(NEW.topup_ref, 0) * 100)::bigint;
          NEW.frozen_reason := CASE
            WHEN ledger_minor < 0 THEN COALESCE(
              NULLIF(NEW.frozen_reason, ''),
              'legacy_debt_reconciliation'
            )
            WHEN NEW.frozen_reason = 'legacy_debt_reconciliation' THEN NULL
            ELSE NEW.frozen_reason
          END;
        ELSIF minor_changed AND NOT legacy_changed THEN
          -- A new app write is mirrored for an immediate image rollback.
          NEW.balance := (NEW.balance_minor - NEW.debt_minor)::numeric / 100;
          NEW.topup_ref := NEW.topup_ref_minor::numeric / 100;
        ELSIF legacy_changed AND minor_changed THEN
          IF round(NEW.balance * 100)::bigint <> NEW.balance_minor - NEW.debt_minor
             OR round(NEW.topup_ref * 100)::bigint <> NEW.topup_ref_minor THEN
            RAISE EXCEPTION 'wallet compatibility write supplied conflicting major/minor values';
          END IF;
        END IF;
        RETURN NEW;
      END
      $function$
    $definition$;

    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'wallets'::regclass
         AND tgname = 'kelion_legacy_wallet_bridge'
         AND NOT tgisinternal
    ) THEN
      EXECUTE 'CREATE TRIGGER kelion_legacy_wallet_bridge
        BEFORE INSERT OR UPDATE ON wallets
        FOR EACH ROW EXECUTE FUNCTION public.kelion_legacy_wallet_bridge()';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'billing_events'::regclass AND attname = 'amount' AND NOT attisdropped
  ) THEN
    EXECUTE $definition$
      CREATE OR REPLACE FUNCTION public.kelion_legacy_billing_bridge()
      RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = public, pg_temp
      AS $function$
      DECLARE
        allocated_minor BIGINT;
      BEGIN
        IF NEW.amount IS NOT NULL AND NEW.amount_minor IS NULL THEN
          IF NEW.kind = 'usage' THEN
            PERFORM pg_advisory_xact_lock(hashtext(
              'kelion-legacy-billing:' || lower(NEW.user_email) || ':' || NEW.kind
            ));
            SELECT round((COALESCE(sum(amount), 0) + NEW.amount) * 100)::bigint
                   - COALESCE(sum(amount_minor), 0)::bigint
              INTO allocated_minor
              FROM billing_events
             WHERE lower(user_email) = lower(NEW.user_email)
               AND kind = NEW.kind;
            NEW.amount_minor := allocated_minor;
          ELSIF NEW.kind = 'refund' THEN
            NEW.amount_minor := -abs(round(NEW.amount * 100)::bigint);
          ELSIF NEW.kind = 'topup' THEN
            NEW.amount_minor := floor(NEW.amount * 100)::bigint;
          ELSIF NEW.kind IN ('profit', 'margin') THEN
            NEW.amount_minor := ceil(NEW.amount * 100)::bigint;
          ELSE
            NEW.amount_minor := round(NEW.amount * 100)::bigint;
          END IF;
          NEW.policy_version := COALESCE(
            NULLIF(NEW.policy_version, ''),
            'legacy-write-compat-v1'
          );
        ELSIF NEW.amount IS NULL AND NEW.amount_minor IS NOT NULL THEN
          NEW.amount := CASE
            WHEN NEW.kind = 'refund' THEN abs(NEW.amount_minor)::numeric / 100
            ELSE NEW.amount_minor::numeric / 100
          END;
        ELSIF NEW.amount IS NULL AND NEW.amount_minor IS NULL THEN
          RAISE EXCEPTION 'billing compatibility write omitted both amount representations';
        END IF;

        NEW.currency := COALESCE(NULLIF(upper(NEW.currency), ''), 'GBP');
        NEW.policy_version := COALESCE(
          NULLIF(NEW.policy_version, ''),
          'legacy-write-compat-v1'
        );
        RETURN NEW;
      END
      $function$
    $definition$;

    IF EXISTS (
      SELECT 1 FROM pg_attribute
       WHERE attrelid = 'wallets'::regclass AND attname = 'balance' AND NOT attisdropped
    ) THEN
      EXECUTE $definition$
        CREATE OR REPLACE FUNCTION public.kelion_legacy_billing_wallet_sync()
      RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = public, pg_temp
      AS $function$
      DECLARE
        ledger_minor BIGINT;
      BEGIN
        IF NEW.policy_version = 'legacy-write-compat-v1'
           AND NEW.kind IN ('topup', 'usage', 'refund', 'grant') THEN
          -- Lock first, then read the ledger in a new READ COMMITTED statement.
          -- Otherwise a waiter could calculate before the lock, resume after a
          -- concurrent commit, and overwrite the wallet with a stale sum.
          PERFORM 1
            FROM wallets
           WHERE lower(user_email) = lower(NEW.user_email)
           FOR UPDATE;
          ledger_minor := public.kelion_legacy_wallet_ledger_minor(NEW.user_email);
          PERFORM set_config('kelion.compat_internal_wallet_sync', 'on', true);
          UPDATE wallets
             SET balance_minor = greatest(ledger_minor, 0),
                 debt_minor = greatest(-ledger_minor, 0),
                 frozen_reason = CASE
                   WHEN ledger_minor < 0 THEN COALESCE(
                     NULLIF(frozen_reason, ''),
                     'legacy_debt_reconciliation'
                   )
                   WHEN frozen_reason = 'legacy_debt_reconciliation' THEN NULL
                   ELSE frozen_reason
                 END,
                 updated_at = now()
           WHERE lower(user_email) = lower(NEW.user_email);
          PERFORM set_config('kelion.compat_internal_wallet_sync', 'off', true);
        END IF;
        RETURN NEW;
      END
      $function$
      $definition$;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'billing_events'::regclass
         AND tgname = 'kelion_legacy_billing_bridge'
         AND NOT tgisinternal
    ) THEN
      EXECUTE 'CREATE TRIGGER kelion_legacy_billing_bridge
        BEFORE INSERT ON billing_events
        FOR EACH ROW EXECUTE FUNCTION public.kelion_legacy_billing_bridge()';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_attribute
       WHERE attrelid = 'wallets'::regclass AND attname = 'balance' AND NOT attisdropped
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'billing_events'::regclass
         AND tgname = 'kelion_legacy_billing_wallet_sync'
         AND NOT tgisinternal
    ) THEN
      EXECUTE 'CREATE TRIGGER kelion_legacy_billing_wallet_sync
        AFTER INSERT ON billing_events
        FOR EACH ROW EXECUTE FUNCTION public.kelion_legacy_billing_wallet_sync()';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'transactions'::regclass AND attname = 'amount' AND NOT attisdropped
  ) THEN
    EXECUTE $definition$
      CREATE OR REPLACE FUNCTION public.kelion_legacy_transaction_bridge()
      RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = public, pg_temp
      AS $function$
      DECLARE
        legacy_write BOOLEAN := false;
      BEGIN
        IF NEW.amount IS NOT NULL AND (
          NEW.gross_minor IS NULL
          OR (
            TG_OP = 'UPDATE'
            AND NEW.amount IS DISTINCT FROM OLD.amount
            AND NEW.gross_minor IS NOT DISTINCT FROM OLD.gross_minor
          )
        ) THEN
          IF NEW.amount * 100 <> trunc(NEW.amount * 100) THEN
            RAISE EXCEPTION 'transactions.amount contains a sub-penny compatibility write';
          END IF;
          NEW.gross_minor := (NEW.amount * 100)::bigint;
          legacy_write := true;
        ELSIF NEW.amount IS NULL AND NEW.gross_minor IS NOT NULL THEN
          NEW.amount := NEW.gross_minor::numeric / 100;
        ELSIF NEW.amount IS NULL AND NEW.gross_minor IS NULL THEN
          RAISE EXCEPTION 'transaction compatibility write omitted both amount representations';
        END IF;

        IF legacy_write OR (
          TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
        ) THEN
          NEW.user_credit_minor := CASE
            WHEN lower(NEW.status) IN ('paid', 'refunded')
              THEN floor((NEW.gross_minor::numeric * 3) / 4)::bigint
            ELSE 0
          END;
        END IF;

        IF NEW.gross_minor < 0 OR NEW.user_credit_minor IS NULL
           OR NEW.user_credit_minor < 0 OR NEW.user_credit_minor > NEW.gross_minor THEN
          RAISE EXCEPTION 'transaction compatibility write has invalid minor units';
        END IF;
        IF lower(NEW.status) IN ('paid', 'refunded')
           AND NEW.user_credit_minor <> floor((NEW.gross_minor::numeric * 3) / 4)::bigint THEN
          RAISE EXCEPTION 'transaction compatibility write violates floor 75 percent';
        END IF;

        NEW.currency := COALESCE(NULLIF(upper(NEW.currency), ''), 'GBP');
        NEW.policy_version := COALESCE(
          NULLIF(NEW.policy_version, ''),
          'legacy-write-compat-v1'
        );
        RETURN NEW;
      END
      $function$
    $definition$;

    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'transactions'::regclass
         AND tgname = 'kelion_legacy_transaction_bridge'
         AND NOT tgisinternal
    ) THEN
      EXECUTE 'CREATE TRIGGER kelion_legacy_transaction_bridge
        BEFORE INSERT OR UPDATE ON transactions
        FOR EACH ROW EXECUTE FUNCTION public.kelion_legacy_transaction_bridge()';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'cost_events'::regclass AND attname = 'cost_usd' AND NOT attisdropped
  ) THEN
    EXECUTE $definition$
      CREATE OR REPLACE FUNCTION public.kelion_legacy_cost_bridge()
      RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = public, pg_temp
      AS $function$
      DECLARE
        allocated_micros BIGINT;
      BEGIN
        IF NEW.cost_usd IS NOT NULL AND NEW.cost_usd_micros IS NULL THEN
          IF NEW.cost_usd < 0 THEN
            RAISE EXCEPTION 'cost compatibility write is negative';
          END IF;
          PERFORM pg_advisory_xact_lock(hashtext(
            'kelion-legacy-cost:' || lower(NEW.user_email) || ':' || NEW.kind
          ));
          SELECT round(
                   (COALESCE(sum(cost_usd::numeric), 0) + NEW.cost_usd::numeric)
                   * 1000000
                 )::bigint
                 - COALESCE(sum(cost_usd_micros), 0)::bigint
            INTO allocated_micros
            FROM cost_events
           WHERE lower(user_email) = lower(NEW.user_email)
             AND kind = NEW.kind;
          NEW.cost_usd_micros := allocated_micros;
        ELSIF NEW.cost_usd IS NULL AND NEW.cost_usd_micros IS NOT NULL THEN
          NEW.cost_usd := NEW.cost_usd_micros::double precision / 1000000;
        ELSIF NEW.cost_usd IS NULL AND NEW.cost_usd_micros IS NULL THEN
          RAISE EXCEPTION 'cost compatibility write omitted both amount representations';
        END IF;

        IF NEW.cost_usd_micros < 0 THEN
          RAISE EXCEPTION 'cost compatibility write produced negative micros';
        END IF;
        RETURN NEW;
      END
      $function$
    $definition$;

    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'cost_events'::regclass
         AND tgname = 'kelion_legacy_cost_bridge'
         AND NOT tgisinternal
    ) THEN
      EXECUTE 'CREATE TRIGGER kelion_legacy_cost_bridge
        BEFORE INSERT ON cost_events
        FOR EACH ROW EXECUTE FUNCTION public.kelion_legacy_cost_bridge()';
    END IF;
  END IF;
END
$compatibility$;

ALTER TABLE wallets ALTER COLUMN balance_minor SET DEFAULT 0;
ALTER TABLE wallets ALTER COLUMN balance_minor SET NOT NULL;
ALTER TABLE wallets ALTER COLUMN topup_ref_minor SET DEFAULT 0;
ALTER TABLE wallets ALTER COLUMN topup_ref_minor SET NOT NULL;
ALTER TABLE wallets ALTER COLUMN debt_minor SET DEFAULT 0;
ALTER TABLE wallets ALTER COLUMN debt_minor SET NOT NULL;

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
