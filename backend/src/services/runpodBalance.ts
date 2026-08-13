// ── SOLDUL REAL DE LA RUNPOD (placa lucrătorului) ────────────────────────────
// Adrian, 12 aug: „afișarea creditului aici, să ai și informațiile reale".
//
// Spre deosebire de Google (care NU expune sold prin niciun API), RunPod ÎL DĂ:
// GraphQL `myself { clientBalance }`. Deci aici e o cifră CITITĂ de la furnizor,
// nu estimată — aceeași familie ca Serper `/account`, nu ca Gemini.
//
// Cheia + URL-ul sunt cele ale constructorului (CONSTRUCTOR_DEEPSEEK_*): dacă
// URL-ul e RunPod, cheia e o cheie RunPod, deci pot întreba soldul. Dacă nu e
// RunPod (ex. DeepSeek cloud) sau lipsește cheia — spun DE CE, nu inventez un 0
// (regula #1: o citire imposibilă nu se prezintă ca „£0.00").
export interface RunpodBalance {
  ok: boolean
  /** Furnizorul creierului constructorului, dedus din URL: 'RunPod' / 'DeepInfra'
   *  / hostname. Afișat pe pastilă ca nume real (nu mai scrie „RunPod" fix). */
  provider?: string
  /** Endpoint-ul RĂSPUNDE (cheia validă). Pentru furnizorii care NU expun sold
   *  prin API (ex. DeepInfra — verificat 12 aug: billing/balance = 404), ăsta e
   *  semnalul afișat (✓/⚠) în locul unei cifre pe care nu o putem citi. */
  live?: boolean
  /** Soldul preplătit, în USD — DOAR la furnizorii care-l expun (RunPod). */
  balanceUsd?: number
  /** Plafonul de rată permis ($/oră) — RunPod nu te lasă peste. */
  spendLimitPerHr?: number
  /** Cât cheltuiești ACUM ($/oră). 0 = placa stinsă (£0). */
  currentSpendPerHr?: number
  /** Motivul, când nu s-a putut citi (not_configured / http_* / rețea). */
  error?: string
}

let cache: { la: number; val: RunpodBalance } | null = null
const TTL_MS = 60_000

/** Citește soldul RunPod din contul ownerului. Cheia + URL-ul vin din env-ul
 *  constructorului (CONSTRUCTOR_DEEPSEEK_*). Cache 1 min, ca polling-ul pastilei
 *  (~30s) să nu bată RunPod la fiecare tick. `force` sare peste cache. */
export async function getRunpodBalance(force = false): Promise<RunpodBalance> {
  // NUMELE DE ENV, ÎMPĂCATE (owner, 13 aug: RunPod „nu apare deloc" în credite):
  // clientul constructorului acceptă CONSTRUCTOR_RUNPOD_* SAU CONSTRUCTOR_DEEPSEEK_*.
  // Dacă aici citeam DOAR ..._DEEPSEEK_*, un RunPod pus sub ..._RUNPOD_* ieșea
  // „not_configured" → becul lui de credit (roșu la 402) NU se arăta deloc, exact
  // ce l-a lăsat orb pe furnizorul picat. Citim ambele nume, RunPod-ul întâi.
  const key = (process.env.CONSTRUCTOR_RUNPOD_KEY ?? process.env.CONSTRUCTOR_DEEPSEEK_KEY ?? '').trim()
  const url = (process.env.CONSTRUCTOR_RUNPOD_URL ?? process.env.CONSTRUCTOR_DEEPSEEK_URL ?? '').trim()
  if (!key || !url) return { ok: false, error: 'not_configured' }
  if (!force && cache && Date.now() - cache.la < TTL_MS) return cache.val

  const esteRunpod = /runpod\.ai/i.test(url)
  const esteDeepInfra = /deepinfra\.com/i.test(url)
  const provider = esteRunpod ? 'RunPod' : esteDeepInfra ? 'DeepInfra' : (url.match(/^https?:\/\/([^/]+)/i)?.[1] ?? 'endpoint')
  const eroareRetea = (e: unknown): RunpodBalance => ({ ok: false, provider, live: false, error: `retea: ${String((e as Error)?.message ?? e).slice(0, 80)}` })

  // RunPod EXPUNE soldul (GraphQL myself.clientBalance) — cifră CITITĂ, nu estimată.
  if (esteRunpod) {
    try {
      const r = await fetch('https://api.runpod.io/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ query: 'query { myself { clientBalance spendLimit currentSpendPerHr } }' }),
        signal: AbortSignal.timeout(8000),
      })
      if (!r.ok) return { ok: false, provider, live: false, error: `http_${r.status}` }
      const j = (await r.json()) as {
        data?: { myself?: { clientBalance?: number; spendLimit?: number; currentSpendPerHr?: number } }
      }
      const m = j?.data?.myself
      if (!m || typeof m.clientBalance !== 'number') return { ok: false, provider, live: false, error: 'raspuns_neinteles' }
      const val: RunpodBalance = {
        ok: true,
        provider,
        live: true,
        balanceUsd: m.clientBalance,
        spendLimitPerHr: typeof m.spendLimit === 'number' ? m.spendLimit : undefined,
        currentSpendPerHr: typeof m.currentSpendPerHr === 'number' ? m.currentSpendPerHr : undefined,
      }
      cache = { la: Date.now(), val }
      return val
    } catch (e) {
      return eroareRetea(e)
    }
  }

  // Furnizor GĂZDUIT (ex. DeepInfra): NU expune sold prin API (măsurat 12 aug:
  // billing/balance = 404; /v1/me dă doar identitatea). Nu inventăm o cifră
  // (regula #1) — verificăm DOAR că servește, GRATIS, pe /v1/me (cheie validă →
  // 200). Soldul rămâne pe dashboard-ul furnizorului. Alt endpoint necunoscut →
  // „configurat" (cheie + URL prezente), fără ping, ca să nu ghicim o rută gratuită.
  if (esteDeepInfra) {
    try {
      const origin = url.match(/^(https?:\/\/[^/]+)/i)?.[1] ?? 'https://api.deepinfra.com'
      const r = await fetch(`${origin}/v1/me`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) })
      const val: RunpodBalance = { ok: r.ok, provider, live: r.ok, error: r.ok ? undefined : `http_${r.status}` }
      cache = { la: Date.now(), val }
      return val
    } catch (e) {
      return eroareRetea(e)
    }
  }

  const val: RunpodBalance = { ok: true, provider, live: true }
  cache = { la: Date.now(), val }
  return val
}
