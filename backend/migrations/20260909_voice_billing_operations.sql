BEGIN;

-- Durable coordination for voice-minute charges. The money event remains in
-- billing_events; this row records whether the web process acknowledged it,
-- handed it to provider consumption, or must compensate it after a restart.
-- No user identity is duplicated here: refunds derive it from debit_event_id.
CREATE TABLE IF NOT EXISTS voice_billing_operations (
  debit_ref TEXT PRIMARY KEY,
  debit_event_id BIGINT NOT NULL UNIQUE REFERENCES billing_events(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  tick BIGINT NOT NULL CHECK (tick > 0),
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'handed_off', 'acknowledged', 'refund_pending', 'refunded')),
  consume_deadline TIMESTAMPTZ NOT NULL,
  handoff_token UUID,
  handed_off_at TIMESTAMPTZ,
  ack_deadline TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  refund_event_id BIGINT UNIQUE REFERENCES billing_events(id) ON DELETE CASCADE,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT voice_billing_ref_shape CHECK (
    debit_ref ~ '^voice-debit:v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[1-9][0-9]{0,8}$'
  ),
  CONSTRAINT voice_billing_terminal_shape CHECK (
    (state = 'pending' AND handoff_token IS NULL AND handed_off_at IS NULL AND ack_deadline IS NULL AND acknowledged_at IS NULL AND refund_event_id IS NULL AND refunded_at IS NULL)
    OR (state = 'handed_off' AND handoff_token IS NOT NULL AND handed_off_at IS NOT NULL AND ack_deadline IS NOT NULL AND acknowledged_at IS NULL AND refund_event_id IS NULL AND refunded_at IS NULL)
    OR (state = 'acknowledged' AND handoff_token IS NOT NULL AND handed_off_at IS NOT NULL AND ack_deadline IS NOT NULL AND acknowledged_at IS NOT NULL AND refund_event_id IS NULL AND refunded_at IS NULL)
    OR (state = 'refund_pending' AND acknowledged_at IS NULL AND refund_event_id IS NULL AND refunded_at IS NULL)
    OR (state = 'refunded' AND acknowledged_at IS NULL AND refund_event_id IS NOT NULL AND refunded_at IS NOT NULL)
  ),
  UNIQUE (session_id, tick)
);

CREATE INDEX IF NOT EXISTS voice_billing_reconciliation_queue
  ON voice_billing_operations (state, updated_at)
  WHERE state IN ('pending', 'handed_off', 'refund_pending');

COMMIT;
