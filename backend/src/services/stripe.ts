import crypto from 'node:crypto'
import { config } from '../config.js'
import { getStripeCustomer, setStripeCustomer } from '../db.js'

// Thin Stripe client over the REST API (no SDK dependency). Handles: a customer
// per user, a Checkout Session for a credit top-up, and webhook signature
// verification (the only security-critical part — done with a timing-safe HMAC).

const API = 'https://api.stripe.com/v1'

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.stripe.secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
}

async function ensureCustomer(email: string, name: string): Promise<string | null> {
  const existing = await getStripeCustomer(email)
  if (existing) return existing
  const body = new URLSearchParams({ email })
  if (name) body.set('name', name)
  const r = await fetch(`${API}/customers`, { method: 'POST', headers: authHeaders(), body })
  if (!r.ok) return null
  const j = (await r.json()) as { id?: string }
  if (!j.id) return null
  await setStripeCustomer(email, j.id)
  return j.id
}

export type CheckoutResult = { url: string } | { error: string }

// Create a one-off Checkout Session that tops the wallet up by `pounds`.
export async function createCheckout(
  email: string,
  name: string,
  pounds: number,
  baseUrl: string,
): Promise<CheckoutResult> {
  if (!config.stripe.secretKey) return { error: 'stripe_not_configured' }
  const amount = Math.max(1, Math.min(500, Math.round(pounds))) // clamp £1..£500
  const customer = await ensureCustomer(email, name)
  const body = new URLSearchParams()
  body.set('mode', 'payment')
  if (customer) body.set('customer', customer)
  body.set('success_url', `${baseUrl}/?topup=success`)
  body.set('cancel_url', `${baseUrl}/?topup=cancel`)
  body.set('line_items[0][quantity]', '1')
  body.set('line_items[0][price_data][currency]', config.stripe.currency)
  body.set('line_items[0][price_data][unit_amount]', String(amount * 100))
  body.set('line_items[0][price_data][product_data][name]', 'Kelion credit')
  body.set('metadata[email]', email)
  const r = await fetch(`${API}/checkout/sessions`, { method: 'POST', headers: authHeaders(), body })
  if (!r.ok) return { error: `stripe_http_${r.status}` }
  const j = (await r.json()) as { url?: string }
  return j.url ? { url: j.url } : { error: 'no_checkout_url' }
}

// The REAL Stripe balance (money actually held at Stripe), summed per state and
// returned in major units of the account currency. This is the owner's true
// revenue-side figure — not a hand-typed number.
export async function getStripeBalance(): Promise<{
  available: number
  pending: number
  currency: string
} | null> {
  if (!config.stripe.secretKey) return null
  const r = await fetch(`${API}/balance`, { headers: authHeaders() })
  if (!r.ok) return null
  const j = (await r.json()) as {
    available?: { amount: number; currency?: string }[]
    pending?: { amount: number; currency?: string }[]
  }
  // BUG FIX (4 iul): Stripe returns one entry PER CURRENCY. Summing them all
  // into a single figure mixed gbp+usd+eur into one meaningless number (that's
  // how the panel showed a bogus balance). Count ONLY the account currency.
  const cur = config.stripe.currency
  const sum = (arr?: { amount: number; currency?: string }[]): number =>
    (arr ?? [])
      .filter((x) => !x.currency || x.currency.toLowerCase() === cur)
      .reduce((s, x) => s + x.amount, 0) / 100
  return { available: sum(j.available), pending: sum(j.pending), currency: cur }
}

export interface StripeEvent {
  type: string
  data: { object: Record<string, unknown> }
}

// Verify a webhook payload against the signing secret (Stripe's scheme:
// HMAC-SHA256 over `${timestamp}.${rawBody}`, timing-safe compare, 5-min window).
export function verifyWebhook(raw: string, sigHeader: string): StripeEvent | null {
  const secret = config.stripe.webhookSecret
  if (!secret || !sigHeader || !raw) return null
  const parts: Record<string, string> = {}
  for (const kv of sigHeader.split(',')) {
    const i = kv.indexOf('=')
    if (i > 0) parts[kv.slice(0, i)] = kv.slice(i + 1)
  }
  const t = parts.t
  const v1 = parts.v1
  if (!t || !v1) return null
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return null
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(v1)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    return JSON.parse(raw) as StripeEvent
  } catch {
    return null
  }
}
