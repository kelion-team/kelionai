// Client helpers for the credit system. The USER sees CREDITS (+ the % of their
// last top-up still left, for the low-credit alerts). The ADMIN sees real money
// (the provider pool) via the admin endpoints.

export interface WalletStatus {
  credits: number
  percent: number
  currency: string
}

export interface PurchaseRecord {
  id: number
  user_id: string
  amount: number
  credits: number
  status: string
  stripe_payment_intent_id: string | null
  created_at: string
}

export async function fetchBalance(): Promise<WalletStatus | null> {
  try {
    const r = await fetch('/api/billing/balance', { credentials: 'include' })
    if (!r.ok) return null
    return (await r.json()) as WalletStatus
  } catch {
    return null
  }
}

// Start a top-up: ask the backend for a Stripe Checkout URL and redirect there.
export async function startCheckout(amount: number): Promise<void> {
  try {
    const r = await fetch('/api/billing/checkout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
    })
    if (!r.ok) return
    const j = (await r.json()) as { url?: string }
    if (j.url) window.location.href = j.url
  } catch {
    /* ignore — button stays clickable to retry */
  }
}

// ORDIN #6G: create a Stripe PaymentIntent for a direct top-up.
export async function createPaymentIntent(
  amount: number,
): Promise<{ client_secret: string; payment_intent_id: string; amount: number; currency: string } | null> {
  try {
    const r = await fetch('/api/billing/payment-intent', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
    })
    if (!r.ok) return null
    return (await r.json()) as { client_secret: string; payment_intent_id: string; amount: number; currency: string }
  } catch {
    return null
  }
}

// ORDIN #6G: user purchase history from the transactions table.
export async function fetchHistory(): Promise<{ history: PurchaseRecord[] } | null> {
  try {
    const r = await fetch('/api/billing/history', { credentials: 'include' })
    if (!r.ok) return null
    return (await r.json()) as { history: PurchaseRecord[] }
  } catch {
    return null
  }
}
