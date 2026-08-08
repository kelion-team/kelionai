// ── IZVORUL DE PIAȚĂ (Adrian, 4 aug: „reală, cu tot ce există pe piață") ─────
// Un singur loc pentru datele reale: crypto intraday (Binance, fără cheie),
// bursă/indici/valute/mărfuri pe zile (Stooq, fără cheie). Îl beau și pagina
// de tranzacționare, și patrula 24/24 (pietar.ts). Eșec = eroarea verbatim.

const B_BINANCE = 'https://api.binance.com/api/v3'
const INTERVALE = new Set(['1m', '15m', '1h', '4h', '1d'])

export interface Lumanare {
  t: number
  deschis: number
  maxim: number
  minim: number
  inchis: number
  volum: number
}

export interface DatePiata {
  simbol: string
  sursa: string
  interval: string
  pret: number
  variatie24h: number
  lumanari: Lumanare[]
}

/** Crypto intraday, Binance public (fără cheie). */
export async function dateBinance(s: string, interval: string): Promise<DatePiata | { error: string }> {
  const [t24r, klr] = await Promise.all([
    fetch(`${B_BINANCE}/ticker/24hr?symbol=${s}`, { signal: AbortSignal.timeout(8000) }),
    fetch(`${B_BINANCE}/klines?symbol=${s}&interval=${interval}&limit=120`, { signal: AbortSignal.timeout(8000) }),
  ])
  if (!t24r.ok || !klr.ok) return { error: `Binance a refuzat „${s}" (HTTP ${t24r.ok ? klr.status : t24r.status})` }
  const t24 = (await t24r.json()) as { lastPrice?: string; priceChangePercent?: string }
  const kl = (await klr.json()) as [number, string, string, string, string, string][]
  return {
    simbol: s,
    sursa: 'Binance (crypto, intraday)',
    interval,
    pret: Number(t24.lastPrice ?? 0),
    variatie24h: Number(t24.priceChangePercent ?? 0),
    lumanari: kl.map((k) => ({ t: k[0], deschis: Number(k[1]), maxim: Number(k[2]), minim: Number(k[3]), inchis: Number(k[4]), volum: Number(k[5]) })),
  }
}

/** Acțiuni/indici pe date ZILNICE reale, Stooq (fără cheie): AAPL.US, ^SPX... */
export async function dateStooq(s: string): Promise<DatePiata | { error: string }> {
  const r = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(s.toLowerCase())}&i=d`, { signal: AbortSignal.timeout(8000) })
  if (!r.ok) return { error: `Stooq a refuzat „${s}" (HTTP ${r.status})` }
  const csv = (await r.text()).trim()
  const linii = csv.split('\n').slice(1).filter(Boolean)
  if (linii.length < 2 || !csv.startsWith('Date,')) return { error: `Stooq nu are date pentru „${s}" — încearcă AAPL.US, TSLA.US, ^SPX, ^DJI, ^DAX` }
  const lum = linii.slice(-120).map((l) => {
    const [d, o, h, lo, c, v] = l.split(',')
    return { t: Date.parse(d), deschis: Number(o), maxim: Number(h), minim: Number(lo), inchis: Number(c), volum: Number(v ?? 0) }
  }).filter((x) => Number.isFinite(x.inchis))
  const ultim = lum[lum.length - 1]
  const penultim = lum[lum.length - 2]
  if (!ultim || !penultim) return { error: `prea puține date pentru „${s}"` }
  return {
    simbol: s.toUpperCase(),
    sursa: 'Stooq (bursă, lumânări zilnice)',
    interval: '1d',
    pret: ultim.inchis,
    variatie24h: Number((((ultim.inchis - penultim.inchis) / penultim.inchis) * 100).toFixed(2)),
    lumanari: lum,
  }
}

/** Datele REALE ale unui simbol: crypto → Binance intraday; altfel Stooq zilnic. */
export async function dateSimbol(simbolBrut: string, intervalBrut: string): Promise<DatePiata | { error: string }> {
  const s = simbolBrut.toUpperCase().replace(/[^A-Z0-9.^]/g, '').slice(0, 14)
  const interval = INTERVALE.has(intervalBrut) ? intervalBrut : '1h'
  if (!s) return { error: 'simbol gol' }
  try {
    // Simbolurile cu punct sau ^ sunt bursiere (Stooq); restul încearcă întâi
    // Binance, iar dacă crypto nu-l știe, cade cinstit pe Stooq.
    if (/[.^]/.test(s)) return await dateStooq(s)
    const cripto = await dateBinance(s, interval)
    if (!('error' in cripto)) return cripto
    // Nu-i crypto: încearcă Stooq gol (valute ca EURUSD, mărfuri) apoi ca
    // acțiune americană (AAPL → AAPL.US).
    const brut = await dateStooq(s)
    if (!('error' in brut)) return brut
    const bursa = await dateStooq(`${s}.US`)
    return 'error' in bursa ? cripto : bursa
  } catch (e) {
    return { error: `piața necitibilă acum: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` }
  }
}

/** Rezumatul numeric pe care îl primește agentul — FAPTE, nu impresii. */
export function rezumatPentruAgent(d: DatePiata): string {
  const l = d.lumanari
  const min = Math.min(...l.map((x) => x.minim))
  const max = Math.max(...l.map((x) => x.maxim))
  const medie = l.reduce((a, b) => a + b.inchis, 0) / (l.length || 1)
  const ultimele12 = l.slice(-12).map((x) => `${new Date(x.t).toISOString().slice(5, 16)} O:${x.deschis} H:${x.maxim} L:${x.minim} C:${x.inchis} V:${Math.round(x.volum)}`)
  return (
    `Simbol: ${d.simbol} | Sursă: ${d.sursa} | Interval lumânare: ${d.interval} | Preț acum: ${d.pret} | Variație 24h: ${d.variatie24h}%.\n` +
    `Pe ultimele ${l.length} lumânări: minim ${min}, maxim ${max}, medie închideri ${medie.toFixed(2)}.\n` +
    `Ultimele 12 lumânări:\n${ultimele12.join('\n')}`
  )
}

