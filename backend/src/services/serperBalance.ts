// ── THE REAL SERPER CREDIT, READ FROM THE PROVIDER ──────────────────────────
//
// The standing order: "show REAL, stop fabricating". Serper powers the web
// search skill, and its remaining credit IS readable: GET
// https://google.serper.dev/account with the X-API-KEY header answers
// { balance: 49875, rateLimit: 50 }.
//
// The honesty rule (regula #1 a ownerului):
// when the key is missing or the read fails we say we CANNOT READ (ok: false)
// and the header pill shows "Serper ⚠" — NEVER "Serper 0", because "I couldn't
// read it" and "you have no credit" would look identical if we stayed silent.
//
// Cached 5 minutes: the header polls /api/admin/brain-credit every 30s
// (usePolledJson, intervalul implicit — cifra corectată la auditul din 3 aug:
// comentariul vechi jura „15s"), and the balance only moves when a search
// actually runs — 30s of freshness would buy nothing but wasted upstream calls.

export interface SerperBalance {
  /** true ONLY when the provider answered with a shape we understand. */
  ok: boolean
  /** The REAL remaining credit (number of searches left), exactly as the
   *  provider's /account endpoint reports it. Meaningful only when `ok` —
   *  stays 0 on failure so old callers don't crash, but `ok` is what the
   *  UI reads (it shows the ⚠ on false). */
  balance: number
  /** The account's rate limit (queries/second), when the provider sends it. */
  rateLimit?: number
  error?: string
}

const ACCOUNT_TTL_MS = 5 * 60 * 1000
let accountCache: { at: number; val: SerperBalance } | null = null

// The shape we expect from GET https://google.serper.dev/account:
// { balance: number, rateLimit: number }
interface AccountBody {
  balance?: number | string
  rateLimit?: number | string
}

export async function getSerperBalance(force = false): Promise<SerperBalance> {
  const base: SerperBalance = { ok: false, balance: 0 }
  // Read LIVE from process.env on every call (not from the boot-time config):
  // Adrian adds the key on the server and expects the pill to heal without a
  // redeploy. Both accepted names from config.ts (SERPER_API_KEY, SERPER_KEY)
  // are honored here.
  const key = (process.env.SERPER_API_KEY ?? process.env.SERPER_KEY ?? '').trim()
  if (!key) return { ...base, error: 'not_configured' }
  if (!force && accountCache && Date.now() - accountCache.at < ACCOUNT_TTL_MS) return accountCache.val
  try {
    const r = await fetch('https://google.serper.dev/account', {
      headers: { 'X-API-KEY': key },
      signal: AbortSignal.timeout(12_000),
    })
    if (!r.ok) return { ...base, error: `http_${r.status}` }
    const j = (await r.json().catch(() => null)) as AccountBody | null
    // ── A RESPONSE I DON'T UNDERSTAND IS NOT "ZERO CREDITS" ─────────────────
    // If the body doesn't parse or the field got renamed at the provider, I
    // say I CANNOT READ. The error carries the RECEIVED KEYS (names only,
    // never values) so the next person sees what came in.
    const balance = Number(j?.balance)
    if (!j || !Number.isFinite(balance)) {
      return { ...base, error: `unexpected_shape:${Object.keys(j ?? {}).join(',').slice(0, 80) || 'empty'}` }
    }
    // A real 0 balance IS a valid measurement — `ok: true` is what separates
    // it from "couldn't read".
    const rateLimit = Number(j.rateLimit)
    const val: SerperBalance = {
      ...base,
      ok: true,
      balance: Math.round(balance),
      rateLimit: Number.isFinite(rateLimit) ? rateLimit : undefined,
    }
    accountCache = { at: Date.now(), val }
    return val
  } catch (e) {
    return { ...base, error: String(e).slice(0, 120) }
  }
}
