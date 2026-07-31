// Client helpers for the credit system. The USER sees CREDITS (+ the % of their
// last top-up still left, for the low-credit alerts). The ADMIN sees real money
// (the provider pool) via the admin endpoints.

export interface WalletStatus {
  credits: number
  percent: number
  currency: string
  // True dacă userul n-a alimentat niciodată: prima alimentare = £20 minim
  // (activarea creierului), apoi orice multiplu de £5.
  firstTopUp?: boolean
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

// Pornește o alimentare: cere serverului linkul de plată și duce omul acolo.
// De la 30 iul linkul e cel de Revolut, nu o sesiune Stripe — dar forma
// răspunsului a rămas aceeași (`{ url }`), tocmai ca toate locurile de plată
// (pastila de portofel, /credite, paywall) să se schimbe dintr-o singură atingere.
// ÎNTOARCE eroarea în loc s-o înghită (Adrian, 24 iul: „apăs pe +credite și nu
// se execută procedura" — orice eșec era tăcut, butonul părea mort).
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

// AICI A STAT `createPaymentIntent` — a doua cale de plată, pe Stripe.js. N-o
// chema nimeni din interfață, iar ruta din spate a fost scoasă odată cu Stripe.

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
