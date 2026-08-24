-- Refunds are separate Merchant orders. Keep their accounting distinct from
-- the original payment while preserving an exact, replay-safe audit trail.
BEGIN;

ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS debt_minor BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS frozen_reason TEXT;

DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM wallets WHERE balance_minor < 0 OR debt_minor < 0) THEN
    RAISE EXCEPTION 'wallet contains a negative balance or debt; reconcile before migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wallet_nonnegative_minor_units'
  ) THEN
    ALTER TABLE wallets
      ADD CONSTRAINT wallet_nonnegative_minor_units
      CHECK (balance_minor >= 0 AND topup_ref_minor >= 0 AND debt_minor >= 0);
  END IF;
END
$migration$;

ALTER TABLE merchant_checkout_orders
  ADD COLUMN IF NOT EXISTS refunded_gross_minor BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_user_credit_minor BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_margin_minor BIGINT NOT NULL DEFAULT 0;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'merchant_checkout_refund_totals'
  ) THEN
    ALTER TABLE merchant_checkout_orders
      ADD CONSTRAINT merchant_checkout_refund_totals CHECK (
        refunded_gross_minor >= 0
        AND refunded_user_credit_minor >= 0
        AND refunded_margin_minor >= 0
        AND refunded_gross_minor <= gross_minor
        AND refunded_user_credit_minor + refunded_margin_minor = refunded_gross_minor
        AND refunded_gross_minor % 4 = 0
        AND refunded_user_credit_minor = (refunded_gross_minor / 4) * 3
        AND refunded_margin_minor = refunded_gross_minor / 4
      );
  END IF;
END
$migration$;

CREATE TABLE IF NOT EXISTS merchant_refund_events (
  provider_refund_order_id UUID PRIMARY KEY,
  original_provider_order_id UUID NOT NULL,
  checkout_id UUID NOT NULL REFERENCES merchant_checkout_orders(id),
  gross_minor BIGINT NOT NULL,
  user_credit_minor BIGINT NOT NULL,
  margin_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  provider_state TEXT NOT NULL,
  last_event TEXT NOT NULL,
  debt_created_minor BIGINT NOT NULL DEFAULT 0,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT merchant_refund_amount_positive CHECK (gross_minor > 0),
  CONSTRAINT merchant_refund_split_exact CHECK (
    gross_minor % 4 = 0
    AND user_credit_minor = (gross_minor / 4) * 3
    AND margin_minor = gross_minor / 4
    AND user_credit_minor + margin_minor = gross_minor
  ),
  CONSTRAINT merchant_refund_debt_nonnegative CHECK (
    debt_created_minor >= 0 AND debt_created_minor <= user_credit_minor
  ),
  CONSTRAINT merchant_refund_currency_shape CHECK (
    currency = upper(currency) AND currency ~ '^[A-Z]{3}$'
  )
);

CREATE INDEX IF NOT EXISTS merchant_refunds_original_order
  ON merchant_refund_events (original_provider_order_id, applied_at);

-- Events that cannot move money automatically are acknowledged only after a
-- durable reconciliation item exists. No raw webhook body or customer PII is
-- stored here.
CREATE TABLE IF NOT EXISTS merchant_reconciliation_events (
  provider_object_id UUID NOT NULL,
  event TEXT NOT NULL,
  object_kind TEXT NOT NULL,
  related_provider_order_id UUID,
  amount_minor BIGINT,
  currency TEXT,
  provider_state TEXT,
  resolution TEXT NOT NULL DEFAULT 'manual_review',
  occurrences INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_object_id, event),
  CONSTRAINT merchant_reconciliation_kind CHECK (object_kind IN ('refund', 'dispute')),
  CONSTRAINT merchant_reconciliation_event_shape CHECK (event ~ '^[A-Z_]{3,64}$'),
  CONSTRAINT merchant_reconciliation_amount CHECK (amount_minor IS NULL OR amount_minor > 0),
  CONSTRAINT merchant_reconciliation_currency CHECK (
    currency IS NULL OR (currency = upper(currency) AND currency ~ '^[A-Z]{3}$')
  ),
  CONSTRAINT merchant_reconciliation_resolution CHECK (
    resolution IN ('pending', 'manual_review', 'resolved')
  ),
  CONSTRAINT merchant_reconciliation_occurrences CHECK (occurrences > 0)
);

CREATE INDEX IF NOT EXISTS merchant_reconciliation_open
  ON merchant_reconciliation_events (resolution, last_seen_at)
  WHERE resolution <> 'resolved';

COMMIT;
