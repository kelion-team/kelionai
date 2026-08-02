// ── THE EXCHANGE RATE: READ LIVE, NEVER TYPED ───────────────────────────────
//
// The owner's standing order: "no hardcode, only REAL". A USD→billing-currency
// rate written by hand in config (USD_TO_CURRENCY, "0.8") is a guess presented
// as a conversion — and money converted with a guessed rate is a fabricated
// figure. The rate EXISTS and is publicly readable, no key needed:
// open.er-api.com publishes daily ECB-referenced rates.
//
// The honesty rule is the same as getOpenRouterBalance / getOpenAiMonthCost:
// if the live read fails we fall back to the env value, but the result SAYS
// the source — `live` vs `env_static` — so nothing downstream can mistake a
// stale static figure for today's rate.
//
// Cached 6 hours: the reference rates move once a day; polling harder buys
// nothing but a dependency on a free endpoint's rate limit.

import { config } from '../config.js'

export type FxSource = 'live' | 'env_static' | 'identity'

export interface FxRate {
  /** billing-currency units per 1 USD. */
  rate: number
  source: FxSource
  /** Set when the live read failed — the received keys / http status, never
   *  silently swallowed (same rule as the provider balance readers). */
  error?: string
}

const FX_TTL_MS = 6 * 60 * 60 * 1000
let fxCache: { at: number; currency: string; val: FxRate } | null = null

// The shape we expect from GET https://open.er-api.com/v6/latest/USD:
// { result: "success", rates: { GBP: 0.79, EUR: 0.92, … } }
interface FxBody {
  result?: string
  rates?: Record<string, number | string>
}

/** Test hook: drop the cache so each test sees a fresh read. */
export function resetFxCache(): void {
  fxCache = null
}

export async function getUsdRate(force = false): Promise<FxRate> {
  const currency = (config.billing.currency || 'usd').toLowerCase()
  // Converting USD→USD needs no rate at all — 1 is not a source, it's identity.
  if (currency === 'usd') return { rate: 1, source: 'identity' }
  if (!force && fxCache && fxCache.currency === currency && Date.now() - fxCache.at < FX_TTL_MS) {
    return fxCache.val
  }
  const fallback = (): FxRate => ({
    rate: config.billing.usdToCurrency,
    source: 'env_static',
  })
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: AbortSignal.timeout(8_000),
    })
    if (!r.ok) return { ...fallback(), error: `http_${r.status}` }
    const j = (await r.json().catch(() => null)) as FxBody | null
    const rate = Number(j?.rates?.[currency.toUpperCase()])
    // ── A RESPONSE I DON'T UNDERSTAND IS NOT "RATE 1.0" ─────────────────────
    // If the endpoint renamed its fields, I say so and fall back LABELED —
    // I don't silently convert money with a wrong rate.
    if (!j || j.result !== 'success' || !Number.isFinite(rate) || !(rate > 0)) {
      return { ...fallback(), error: `unexpected_shape:${Object.keys(j ?? {}).join(',').slice(0, 80) || 'empty'}` }
    }
    const val: FxRate = { rate, source: 'live' }
    fxCache = { at: Date.now(), currency, val }
    return val
  } catch (e) {
    return { ...fallback(), error: String(e).slice(0, 120) }
  }
}
