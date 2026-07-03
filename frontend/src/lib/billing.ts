// Client helpers for the credit system. The USER sees CREDITS (+ the % of their
// last top-up still left, for the low-credit alerts). The ADMIN sees real money
// (the provider pool) via the admin endpoints.

export interface WalletStatus {
  credits: number
  percent: number
  currency: string
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

export function currencySymbol(currency: string): string {
  const map: Record<string, string> = { gbp: '£', usd: '$', eur: '€', ron: 'lei ' }
  return map[currency.toLowerCase()] ?? ''
}

// ── Admin real-money view (the provider pool) ──
export interface AdminAccount {
  loaded: number
  remaining: number
  spent: number
  profit: number
}

export async function fetchPool(): Promise<AdminAccount | null> {
  try {
    const r = await fetch('/api/admin/pool', { credentials: 'include' })
    if (!r.ok) return null
    return (await r.json()) as AdminAccount
  } catch {
    return null
  }
}

export async function loadPool(amount: number): Promise<AdminAccount | null> {
  try {
    const r = await fetch('/api/admin/pool', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
    })
    if (!r.ok) return null
    return (await r.json()) as AdminAccount
  } catch {
    return null
  }
}
