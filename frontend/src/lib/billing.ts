// Client helpers for the credit system. The USER sees CREDITS (+ the % of their
// last top-up still left, for the low-credit alerts). The ADMIN sees real money
// (the provider pool) via the admin endpoints.

export interface WalletStatus {
  credits: number
  percent: number
  currency: string
  // True if the user has never topped up: first top-up = £20 minimum
  // (brain activation), then any multiple of £5.
  firstTopUp?: boolean
  // AUTO TOP-UP, DUE: present only when the user's checkbox is on AND the
  // credit dropped below his threshold — the server has already prepared the
  // unique payment code; the client offers a one-tap button to `url`. The
  // money moves only with the user's tap (the Revolut link cannot pull by
  // itself).
  autoTopUp?: { code: string; amount: number; currency: string; url: string } | null
}

export interface PurchaseRecord {
  id: number
  user_id: string
  amount: number
  credits: number
  status: string
  payment_ref: string | null
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

// Starts a top-up: asks the server for the payment link and takes the person there.
// Since Jul 30 the link is the Revolut one, not a Stripe session — but the shape
// of the reply stayed the same (`{ url }`), precisely so that all payment
// places (the wallet pill, /credite, paywall) change with a single touch.
// It RETURNS the error instead of swallowing it (Adrian, Jul 24: "I press
// +credits and the procedure doesn't run" — every failure was silent, the
// button looked dead).
export async function startCheckout(amount: number): Promise<string | null> {
  try {
    const r = await fetch('/api/billing/checkout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
    })
    const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string }
    if (!r.ok) return j.error ?? `checkout_http_${r.status}`
    if (j.url) {
      window.location.href = j.url
      return null
    }
    return 'no_checkout_url'
  } catch {
    return 'offline'
  }
}

// HERE STOOD `createPaymentIntent` — the second payment path, on Stripe.js.
// Nothing in the interface called it, and the back-end route was removed along with Stripe.

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
