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
  /** Soldul preplătit, în USD (cât mai ai de cheltuit — plafonul dur de faliment). */
  balanceUsd?: number
  /** Plafonul de rată permis ($/oră) — RunPod nu te lasă peste. */
  spendLimitPerHr?: number
  /** Cât cheltuiești ACUM ($/oră). 0 = placa stinsă (£0). */
  currentSpendPerHr?: number
  /** Motivul, când nu s-a putut citi (not_runpod / not_configured / http_* / rețea). */
  error?: string
}

let cache: { la: number; val: RunpodBalance } | null = null
const TTL_MS = 60_000

/** Citește soldul RunPod din contul ownerului. Cheia + URL-ul vin din env-ul
 *  constructorului (CONSTRUCTOR_DEEPSEEK_*). Cache 1 min, ca polling-ul pastilei
 *  (~30s) să nu bată RunPod la fiecare tick. `force` sare peste cache. */
export async function getRunpodBalance(force = false): Promise<RunpodBalance> {
  const key = (process.env.CONSTRUCTOR_DEEPSEEK_KEY ?? '').trim()
  const url = (process.env.CONSTRUCTOR_DEEPSEEK_URL ?? '').trim()
  if (!/runpod\.ai/i.test(url)) return { ok: false, error: 'not_runpod' }
  if (!key) return { ok: false, error: 'not_configured' }
  if (!force && cache && Date.now() - cache.la < TTL_MS) return cache.val
  try {
    const r = await fetch('https://api.runpod.io/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: 'query { myself { clientBalance spendLimit currentSpendPerHr } }' }),
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) return { ok: false, error: `http_${r.status}` }
    const j = (await r.json()) as {
      data?: { myself?: { clientBalance?: number; spendLimit?: number; currentSpendPerHr?: number } }
    }
    const m = j?.data?.myself
    if (!m || typeof m.clientBalance !== 'number') return { ok: false, error: 'raspuns_neinteles' }
    const val: RunpodBalance = {
      ok: true,
      balanceUsd: m.clientBalance,
      spendLimitPerHr: typeof m.spendLimit === 'number' ? m.spendLimit : undefined,
      currentSpendPerHr: typeof m.currentSpendPerHr === 'number' ? m.currentSpendPerHr : undefined,
    }
    cache = { la: Date.now(), val }
    return val
  } catch (e) {
    return { ok: false, error: `retea: ${String((e as Error)?.message ?? e).slice(0, 80)}` }
  }
}
