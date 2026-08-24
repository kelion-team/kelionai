// ── IZVORUL DE PIAȚĂ (Adrian, 4 aug: „reală, cu tot ce există pe piață") ─────
// Un singur loc pentru datele reale: crypto intraday (Binance, fără cheie),
// bursă/indici/valute/mărfuri pe zile (Stooq, fără cheie). Îl beau și pagina
// de tranzacționare, și patrula 24/24 (pietar.ts). Eșec = eroarea verbatim.

import { readResponseTextLimited } from './httpBody.js'
import { config } from '../config.js'

const INTERVALE = new Set(['1m', '15m', '1h', '4h', '1d'])
const SIMBOL_PIATA = /^[A-Z0-9.^]{1,14}$/
const TIMEOUT_MS = 8_000
const MAX_TICKER_BYTES = 32 * 1024
const MAX_CANDLES_BYTES = 256 * 1024
const MAX_MARKET_BYTES = 1024 * 1024
const MAX_CANDLES = 200

function numarPozitiv(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function numarNenegativ(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function lumanareValida(
  timestampMs: unknown,
  deschisBrut: unknown,
  maximBrut: unknown,
  minimBrut: unknown,
  inchisBrut: unknown,
  volumBrut: unknown,
): Lumanare | null {
  const t = Number(timestampMs)
  const deschis = numarPozitiv(deschisBrut)
  const maxim = numarPozitiv(maximBrut)
  const minim = numarPozitiv(minimBrut)
  const inchis = numarPozitiv(inchisBrut)
  const volum = numarNenegativ(volumBrut)
  if (!Number.isFinite(t) || t <= 0 || deschis === null || maxim === null || minim === null || inchis === null || volum === null) return null
  if (maxim < Math.max(deschis, inchis, minim) || minim > Math.min(deschis, inchis, maxim)) return null
  return { t, deschis, maxim, minim, inchis, volum }
}

async function jsonLimitat(response: Response, maxBytes: number): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('json')) throw new Error('upstream_content_type_invalid')
  const text = await readResponseTextLimited(response, maxBytes)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error('upstream_json_invalid')
  }
}

function eroareSursa(sursa: string, simbol: string, error: unknown): { error: string } {
  const motiv = error instanceof Error ? error.message : String(error)
  return { error: `${sursa} nu poate citi „${simbol}": ${motiv.slice(0, 100)}` }
}

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
  assetClass: 'crypto' | 'market'
  intervalMode: 'intraday' | 'daily-only'
  liveFeed: { provider: 'binance'; symbol: string } | null
  pret: number
  variatie24h: number
  lumanari: Lumanare[]
}

export function cererePiata(simbolBrut: unknown, intervalBrut: unknown): { simbol: string; interval: string } | { error: string } {
  const simbol = typeof simbolBrut === 'string' ? simbolBrut.trim().toUpperCase() : ''
  const interval = typeof intervalBrut === 'string' ? intervalBrut.trim() : ''
  if (!SIMBOL_PIATA.test(simbol)) return { error: 'simbol invalid' }
  if (!INTERVALE.has(interval)) return { error: 'interval invalid' }
  return { simbol, interval }
}

/** Crypto intraday, Binance public (fără cheie). */
export async function dateBinance(s: string, interval: string): Promise<DatePiata | { error: string }> {
  const simbol = s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14)
  const intervalSigur = INTERVALE.has(interval) ? interval : '1h'
  if (!/^[A-Z0-9]{5,14}$/.test(simbol)) return { error: 'simbol crypto invalid' }
  try {
    const [t24r, klr] = await Promise.all([
      fetch(`${config.endpoints.binanceRestBase}/api/v3/ticker/24hr?symbol=${encodeURIComponent(simbol)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) }),
      fetch(`${config.endpoints.binanceRestBase}/api/v3/klines?symbol=${encodeURIComponent(simbol)}&interval=${intervalSigur}&limit=120`, { signal: AbortSignal.timeout(TIMEOUT_MS) }),
    ])
    if (!t24r.ok || !klr.ok) return { error: `Binance a refuzat „${simbol}" (HTTP ${t24r.ok ? klr.status : t24r.status})` }
    const t24 = await jsonLimitat(t24r, MAX_TICKER_BYTES)
    const kl = await jsonLimitat(klr, MAX_CANDLES_BYTES)
    if (!t24 || typeof t24 !== 'object' || Array.isArray(t24) || !Array.isArray(kl)) return { error: `Binance a trimis date invalide pentru „${simbol}"` }
    const ticker = t24 as { lastPrice?: unknown; priceChangePercent?: unknown }
    const pret = numarPozitiv(ticker.lastPrice)
    const variatie24h = Number(ticker.priceChangePercent)
    const lumanari = kl
      .slice(-MAX_CANDLES)
      .map((row) => Array.isArray(row) ? lumanareValida(row[0], row[1], row[2], row[3], row[4], row[5]) : null)
      .filter((row): row is Lumanare => row !== null)
    if (pret === null || !Number.isFinite(variatie24h) || lumanari.length < 2) return { error: `Binance a trimis date incomplete pentru „${simbol}"` }
    return {
      simbol,
      sursa: 'Binance (crypto, intraday)',
      interval: intervalSigur,
      assetClass: 'crypto',
      intervalMode: 'intraday',
      liveFeed: { provider: 'binance', symbol: simbol },
      pret,
      variatie24h,
      lumanari,
    }
  } catch (error) {
    return eroareSursa('Binance', simbol, error)
  }
}

/** Acțiuni/indici pe date ZILNICE reale, Stooq (fără cheie): AAPL.US, ^SPX... */
export async function dateStooq(s: string): Promise<DatePiata | { error: string }> {
  const simbol = s.toUpperCase().replace(/[^A-Z0-9.^]/g, '').slice(0, 14)
  if (!simbol) return { error: 'simbol bursier invalid' }
  try {
    const r = await fetch(`${config.endpoints.stooqBase}/q/d/l/?s=${encodeURIComponent(simbol.toLowerCase())}&i=d`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!r.ok) return { error: `Stooq a refuzat „${simbol}" (HTTP ${r.status})` }
    const csv = (await readResponseTextLimited(r, MAX_MARKET_BYTES)).trim()
    const linii = csv.split(/\r?\n/).slice(1).filter(Boolean)
    if (linii.length < 2 || !csv.startsWith('Date,')) return { error: `Stooq nu are date pentru „${simbol}" — încearcă AAPL.US, TSLA.US, ^SPX, ^DJI, ^DAX` }
    const lum = linii
      .slice(-MAX_CANDLES)
      .map((linie) => {
        const [d, o, h, lo, c, v] = linie.split(',')
        return lumanareValida(Date.parse(d ?? ''), o, h, lo, c, v ?? 0)
      })
      .filter((row): row is Lumanare => row !== null)
    const ultim = lum[lum.length - 1]
    const penultim = lum[lum.length - 2]
    if (!ultim || !penultim) return { error: `prea puține date valide pentru „${simbol}"` }
    return {
      simbol,
      sursa: 'Stooq (bursă, lumânări zilnice)',
      interval: '1d',
      assetClass: 'market',
      intervalMode: 'daily-only',
      liveFeed: null,
      pret: ultim.inchis,
      variatie24h: Number((((ultim.inchis - penultim.inchis) / penultim.inchis) * 100).toFixed(2)),
      lumanari: lum,
    }
  } catch (error) {
    return eroareSursa('Stooq', simbol, error)
  }
}

// ── YAHOO FINANCE — bursele clasice, CU INTRADAY (10 aug) ────────────────────
// Măsurat: Stooq a pus protecție anti-bot (provocare JavaScript) — serverul
// primea HTML în loc de CSV, deci TOATE simbolurile clasice picau („graficul gol"
// din raportul ownerului). Yahoo v8/chart e gratuit, fără cheie, și dă lumânări
// INTRADAY și pe acțiuni/indici — „ca o platformă reală". Stooq rămâne fallback.
const YAHOO_SIMBOL: Record<string, string> = { '^SPX': '^GSPC', '^DAX': '^GDAXI' }
const YAHOO_INTERVAL: Record<string, { i: string; range: string }> = {
  '1m': { i: '1m', range: '5d' },
  '15m': { i: '15m', range: '1mo' },
  '1h': { i: '60m', range: '3mo' },
  // Yahoo nu are 4h — onest, servim 1h (interval-ul REAL se scrie în răspuns).
  '4h': { i: '60m', range: '3mo' },
  '1d': { i: '1d', range: '1y' },
}

export async function dateYahoo(s: string, interval: string): Promise<DatePiata | { error: string }> {
  const simbol = s.toUpperCase().replace(/[^A-Z0-9.^]/g, '').slice(0, 14)
  if (!simbol) return { error: 'simbol bursier invalid' }
  const sym = YAHOO_SIMBOL[simbol] ?? simbol.replace(/\.US$/, '')
  const { i, range } = YAHOO_INTERVAL[interval] ?? YAHOO_INTERVAL['1h']
  try {
    const r = await fetch(
      `${config.endpoints.yahooFinanceBase}/v8/finance/chart/${encodeURIComponent(sym)}?interval=${i}&range=${range}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': config.httpUserAgent } },
    )
    if (!r.ok) return { error: `Yahoo a refuzat „${simbol}" (HTTP ${r.status})` }
    const body = await jsonLimitat(r, MAX_MARKET_BYTES)
    const j = body && typeof body === 'object' && !Array.isArray(body) ? body as {
      chart?: { result?: { meta?: { regularMarketPrice?: unknown; chartPreviousClose?: unknown; previousClose?: unknown }; timestamp?: unknown[]; indicators?: { quote?: { open?: unknown[]; high?: unknown[]; low?: unknown[]; close?: unknown[]; volume?: unknown[] }[] } }[]; error?: { description?: unknown } | null }
    } : null
    const rez = j?.chart?.result?.[0]
    if (!rez?.timestamp?.length || rez.timestamp.length > 10_000) {
      const descriere = typeof j?.chart?.error?.description === 'string' ? `: ${j.chart.error.description.slice(0, 120)}` : ''
      return { error: `Yahoo nu are date valide pentru „${simbol}"${descriere}` }
    }
    const q = rez.indicators?.quote?.[0]
    const lum: Lumanare[] = []
    for (let k = Math.max(0, rez.timestamp.length - MAX_CANDLES); k < rez.timestamp.length; k++) {
      const c = q?.close?.[k]
      if (c == null) continue // pauzele de tranzacționare vin ca null — nu-s lumânări
      const timestampSec = Number(rez.timestamp[k])
      const row = lumanareValida(timestampSec * 1000, q?.open?.[k] ?? c, q?.high?.[k] ?? c, q?.low?.[k] ?? c, c, q?.volume?.[k] ?? 0)
      if (row) lum.push(row)
    }
    if (lum.length < 2) return { error: `prea puține date Yahoo valide pentru „${simbol}"` }
    const pret = numarPozitiv(rez.meta?.regularMarketPrice) ?? lum[lum.length - 1].inchis
    const anterior = numarPozitiv(rez.meta?.chartPreviousClose) ?? numarPozitiv(rez.meta?.previousClose) ?? lum[lum.length - 2].inchis
    const intervalReal = i === '60m' ? '1h' : i
    return {
      simbol,
      sursa: `Yahoo Finance (bursă, ${intervalReal === '1d' ? 'lumânări zilnice' : 'intraday'})`,
      interval: intervalReal,
      assetClass: 'market',
      intervalMode: 'intraday',
      liveFeed: null,
      pret,
      variatie24h: Number((((pret - anterior) / anterior) * 100).toFixed(2)),
      lumanari: lum,
    }
  } catch (error) {
    return eroareSursa('Yahoo', simbol, error)
  }
}

/** Datele REALE ale unui simbol: crypto → Binance intraday; bursă → Yahoo
 *  (intraday) cu Stooq ca rezervă zilnică. */
export async function dateSimbol(simbolBrut: string, intervalBrut: string): Promise<DatePiata | { error: string }> {
  const cerere = cererePiata(simbolBrut, intervalBrut)
  if ('error' in cerere) return cerere
  const { simbol: s, interval } = cerere
  try {
    // Simbolurile cu punct sau ^ sunt bursiere; restul încearcă întâi Binance.
    if (/[.^]/.test(s)) {
      const y = await dateYahoo(s, interval)
      if (!('error' in y)) return y
      const st = await dateStooq(s)
      return 'error' in st ? y : st
    }
    const cripto = await dateBinance(s, interval)
    if (!('error' in cripto)) return cripto
    // Nu-i crypto: Yahoo gol (valute/mărfuri/acțiuni fără sufix), apoi Stooq.
    const yGol = await dateYahoo(s, interval)
    if (!('error' in yGol)) return yGol
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
