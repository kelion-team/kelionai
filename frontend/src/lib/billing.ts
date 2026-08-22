// LEGEA ANTI-HARDCODARE: creditePeLira vine din /api/tarife (sursă vie:
// userShare / creditValue, reglabil din env). Default 7.5 doar până la primul
// fetch — hardcod-permis: fallback înainte de primul /api/tarife (nu se afișează
// niciodată ca fapt dacă fetch-ul reușește).
let _creditePeLira = 7.5 // hardcod-permis: fallback până la primul /api/tarife (sursă vie); nu se afișează ca fapt
export function getCreditePeLira(): number {
  return _creditePeLira
}
export function setCreditePeLira(v: number): void {
  if (Number.isFinite(v) && v > 0) _creditePeLira = v
}
export const creditsForPounds = (pounds: number, rate = _creditePeLira): number =>
  Math.floor(pounds * rate)

/** Pachetele de alimentare derivate din pragurile serverului (nu hardcodate). */
export function pacheteDinPraguri(praguri: { minim: number; pas: number; primaAlimentare: number }): number[] {
  const { pas } = praguri
  if (!Number.isFinite(pas) || pas <= 0) return [5, 10, 20, 50] // hardcod-permis: fallback dacă /api/tarife a picat
  return [pas * 1, pas * 2, pas * 4, pas * 10]
}

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
  // Owner/admin: scutit de taxare — sold negativ = istoric, NU paywall.
  scutit?: boolean
  // AUTO TOP-UP, DUE: present only when the user's checkbox is on AND the
  // credit dropped below his threshold — the server has already prepared the
  // unique payment code; the client offers a one-tap button to `url`. The
  // money moves only with the user's tap (the Revolut link cannot pull by
  // itself).
  autoTopUp?: { code: string; amount: number; currency: string; url: string } | null
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

// Starts a top-up: asks the server for the payment link AND THE UNIQUE CODE.
// M4 (Aug 2): the old version navigated straight to the Revolut link and threw
// the code away — but the WHOLE matching design depends on the person writing
// that code in the payment reference (Revolut Pro has no webhook; the code is
// the only bridge back to the account). A payment without the shown code can
// only land in the unattributed net. So this no longer navigates: it RETURNS
// the payment data and the caller shows the code first, big, with a copy
// button. One source for every payment place (wallet pill, /credite, paywall).
// It RETURNS the error instead of swallowing it (Adrian, Jul 24: "I press
// +credits and the procedure doesn't run" — every failure was silent, the
// button looked dead).
export interface CheckoutStart {
  url: string
  code: string
  amount: number
  currency: string
}
export async function startCheckout(
  amount: number,
): Promise<{ ok: true; pay: CheckoutStart } | { ok: false; error: string }> {
  try {
    const r = await fetch('/api/billing/checkout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
    })
    const j = (await r.json().catch(() => ({}))) as {
      url?: string
      code?: string
      amount?: number
      currency?: string
      error?: string
    }
    if (!r.ok) return { ok: false, error: j.error ?? `checkout_http_${r.status}` }
    if (j.url && j.code)
      return { ok: true, pay: { url: j.url, code: j.code, amount: Number(j.amount ?? amount), currency: j.currency ?? 'gbp' } }
    return { ok: false, error: 'no_checkout_url' }
  } catch {
    return { ok: false, error: 'offline' }
  }
}

// HERE STOOD `createPaymentIntent` — the second payment path, on Stripe.js.
// Nothing in the interface called it, and the back-end route was removed along with Stripe.

// The user's purchase history (M4 „istoric"). Removed as dead code on Aug 2
// (zero callers), restored the same day WITH a real caller: CustomerSettings
// shows the person their own top-ups.
export interface PurchaseRecord {
  id: number
  amount: number
  credits: number
  status: string
  created_at: string
  code?: string
}
export async function fetchHistory(): Promise<PurchaseRecord[] | null> {
  try {
    const r = await fetch('/api/billing/history', { credentials: 'include' })
    if (!r.ok) return null
    const j = (await r.json()) as { history?: PurchaseRecord[] }
    return Array.isArray(j.history) ? j.history : null
  } catch {
    return null
  }
}
