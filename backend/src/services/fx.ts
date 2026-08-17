// ── CURSUL USD→GBP, CITIT — NU SCRIS DE MÂNĂ ────────────────────────────────
// Regula veche a casei (auditul din 3 aug a extirpat USD_TO_CURRENCY): un curs
// bătut în cod e o minciună cu întârziere. Ăsta se CITEȘTE de la BCE prin
// api.frankfurter.app (fără cheie), se ține 12h în memoria procesului, iar
// eșecul se DECLARĂ — pastila cade atunci pe cifra declarată, nu pe un calcul
// cu un curs inventat.
let cache: { rate: number; la: number } | null = null

export async function cursUsdGbp(): Promise<{ ok: true; rate: number } | { ok: false; motiv: string }> {
  if (cache && Date.now() - cache.la < 12 * 3600_000) return { ok: true, rate: cache.rate }
  try {
    const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=GBP', {
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) return { ok: false, motiv: `HTTP ${r.status}` }
    const j = (await r.json()) as { rates?: { GBP?: number } }
    const rate = j.rates?.GBP
    if (!rate || !Number.isFinite(rate) || rate <= 0) return { ok: false, motiv: 'răspuns fără curs' }
    cache = { rate, la: Date.now() }
    return { ok: true, rate }
  } catch (e) {
    return { ok: false, motiv: e instanceof Error ? e.message.slice(0, 80) : String(e) }
  }
}
