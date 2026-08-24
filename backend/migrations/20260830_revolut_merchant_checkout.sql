-- Durable, idempotent Hosted Checkout state. The provider webhook can only
-- settle a row created here; redirects and unsigned client claims never move
-- product credit.
BEGIN;

CREATE TABLE IF NOT EXISTS merchant_checkout_orders (
  id UUID PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'revolut',
  user_email TEXT NOT NULL,
  idempotency_key UUID NOT NULL,
  gross_minor BIGINT NOT NULL,
  user_credit_minor BIGINT NOT NULL,
  margin_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'creating',
  provider_order_id UUID,
  checkout_url TEXT,
  provider_state TEXT,
  last_event TEXT,
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  legal_basis TEXT,
  retention_until TIMESTAMPTZ,
  erasure_request_id UUID,
  CONSTRAINT merchant_checkout_provider CHECK (provider = 'revolut'),
  CONSTRAINT merchant_checkout_email_normalized CHECK (user_email = lower(user_email)),
  CONSTRAINT merchant_checkout_amount_positive CHECK (gross_minor > 0),
  CONSTRAINT merchant_checkout_split_exact CHECK (
    gross_minor % 4 = 0
    AND user_credit_minor = (gross_minor / 4) * 3
    AND margin_minor = gross_minor / 4
    AND user_credit_minor + margin_minor = gross_minor
  ),
  CONSTRAINT merchant_checkout_currency_shape CHECK (
    currency = upper(currency) AND currency ~ '^[A-Z]{3}$'
  ),
  CONSTRAINT merchant_checkout_status CHECK (
    status IN ('creating', 'pending', 'paid', 'failed', 'cancelled', 'indeterminate')
  ),
  CONSTRAINT merchant_checkout_provider_pair CHECK (
    (provider_order_id IS NULL AND checkout_url IS NULL)
    OR (provider_order_id IS NOT NULL AND checkout_url IS NOT NULL)
  ),
  CONSTRAINT merchant_checkout_paid_time CHECK (
    (status = 'paid' AND paid_at IS NOT NULL)
    OR (status <> 'paid' AND paid_at IS NULL)
  ),
  UNIQUE (user_email, idempotency_key),
  UNIQUE (provider_order_id)
);

CREATE INDEX IF NOT EXISTS merchant_checkout_user_recent
  ON merchant_checkout_orders (user_email, created_at DESC);
CREATE INDEX IF NOT EXISTS merchant_checkout_reconciliation
  ON merchant_checkout_orders (status, updated_at)
  WHERE status IN ('creating', 'indeterminate');

COMMIT;
