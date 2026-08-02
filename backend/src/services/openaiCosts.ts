// ── THE REAL OPENAI SPEND, READ FROM THE PROVIDER ───────────────────────────
//
// Adrian's standing order: "show REAL, stop fabricating". The Money tab used
// to show "voice_minutes $204.52" — minutes with the microphone ON multiplied
// by a fixed rate written by hand in cost.ts — while the OpenAI Usage page
// showed ~$65. An estimate displayed as an invoice is a fabrication.
//
// The real figure EXISTS and can be read: the OpenAI organization costs API
// (GET /v1/organization/costs). It needs an admin/usage key, which Adrian adds
// on the server as OPENAI_USAGE_KEY. Without it we say we CANNOT READ — the
// same honesty rule as getOpenRouterBalance (openrouter.ts): a failed read is
// NEVER shown as "$0.00", because "I couldn't read it" and "you spent nothing"
// look identical if you stay silent.
//
// Cached 5 minutes: the header pill polls every 15s, the provider figure
// moves by the minute at best — 15s of freshness buys nothing but rate limits.

export interface OpenAiMonthCost {
  /** true ONLY when the provider answered with a shape we understand. */
  ok: boolean
  /** The REAL month-to-date spend (USD), summed from the provider's buckets.
   *  Meaningful only when `ok` — the field stays 0 on failure so old callers
   *  don't crash, but `ok: false` is what the UI reads (it shows "⚠"). */
  monthUsd: number
  currency: 'usd'
  /** The month start (unix seconds, UTC) the sum refers to. */
  startTime: number
  error?: string
}

const COSTS_TTL_MS = 5 * 60 * 1000
let costsCache: { at: number; val: OpenAiMonthCost } | null = null

/** Start of the current UTC month, as a unix timestamp (seconds) — the
 *  `start_time` the costs API expects. Exported for the tests. */
export function monthStartUtc(now: number = Date.now()): number {
  const d = new Date(now)
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000)
}

// The shape we expect from GET /v1/organization/costs (bucket_width=1mo):
// { data: [ { results: [ { amount: { value, currency } } ] } ], has_more }
interface CostsPage {
  data?: { results?: { amount?: { value?: number | string; currency?: string } }[] }[]
}

export async function getOpenAiMonthCost(force = false): Promise<OpenAiMonthCost> {
  const startTime = monthStartUtc()
  const base: OpenAiMonthCost = { ok: false, monthUsd: 0, currency: 'usd', startTime }
  // Read LIVE from process.env on every call (not from the boot-time config):
  // Adrian adds the key on the server and expects the pill to heal without
  // anyone touching the code — and the env-check panel reads the process too.
  const key = (process.env.OPENAI_USAGE_KEY ?? '').trim()
  if (!key) return { ...base, error: 'not_configured' }
  if (!force && costsCache && Date.now() - costsCache.at < COSTS_TTL_MS) return costsCache.val
  try {
    const r = await fetch(
      `https://api.openai.com/v1/organization/costs?start_time=${startTime}&bucket_width=1mo`,
      { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(12_000) },
    )
    if (!r.ok) return { ...base, error: `http_${r.status}` }
    const j = (await r.json().catch(() => null)) as CostsPage | null
    // ── A RESPONSE I DON'T UNDERSTAND IS NOT "ZERO DOLLARS" ─────────────────
    // Identical to the OpenRouter rule (see openrouter.ts): if the body doesn't
    // parse or the fields got renamed at the provider, I say I CANNOT READ.
    // The error carries the RECEIVED KEYS (names only, never values) so the
    // next person sees what came in instead of searching for a day.
    if (!j || !Array.isArray(j.data)) {
      return { ...base, error: `unexpected_shape:${Object.keys(j ?? {}).join(',').slice(0, 80) || 'empty'}` }
    }
    let sum = 0
    for (const bucket of j.data) {
      const results = bucket?.results
      if (!Array.isArray(results)) return { ...base, error: 'unexpected_shape:results' }
      for (const res of results) {
        const v = Number(res?.amount?.value)
        if (!Number.isFinite(v)) return { ...base, error: 'unexpected_shape:amount' }
        sum += v
      }
    }
    // A real $0.00 month IS a valid measurement — `ok: true` is what separates
    // it from "couldn't read".
    const val: OpenAiMonthCost = { ...base, ok: true, monthUsd: Math.round(sum * 100) / 100 }
    costsCache = { at: Date.now(), val }
    return val
  } catch (e) {
    return { ...base, error: String(e).slice(0, 120) }
  }
}
