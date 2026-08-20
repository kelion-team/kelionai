import { describe, it, expect } from 'vitest'
import {
  pasVad,
  stareVadInitiala,
  rmsDin,
  zcrDin,
  PARAM_VAD_IMPLICIT,
  type StareVad,
  type ParamVad,
} from './lib/vad'

const P: ParamVad = PARAM_VAD_IMPLICIT
const PAS = 20 // ms per cadru (ca la 16 kHz / bloc)

// Rulează o serie de cadre (rms, zcr) pornind de la tMs=0, la fiecare PAS ms.
// Întoarce starea finală + dacă poarta a fost deschisă la ULTIMUL cadru + de câte
// ori a fost deschisă în total (util pentru „nu s-a deschis niciodată").
function ruleaza(
  st: StareVad,
  cadre: { rms: number; zcr: number }[],
  tStart = 0,
): { st: StareVad; deschisUltim: boolean; deschideri: number; tMs: number } {
  let s = st
  let t = tStart
  let deschisUltim = false
  let deschideri = 0
  for (const c of cadre) {
    const r = pasVad(s, { rms: c.rms, zcr: c.zcr, tMs: t }, P)
    s = r.st
    deschisUltim = r.deschis
    if (r.deschis) deschideri++
    t += PAS
  }
  return { st: s, deschisUltim, deschideri, tMs: t }
}

const rep = (n: number, rms: number, zcr: number) => Array.from({ length: n }, () => ({ rms, zcr }))

describe('rmsDin / zcrDin — măsurători pure', () => {
  it('RMS zero pe tăcere, pozitiv pe semnal', () => {
    expect(rmsDin([0, 0, 0, 0])).toBe(0)
    expect(rmsDin([1, -1, 1, -1])).toBeCloseTo(1, 5)
  })
  it('ZCR: mic pe semnal lent, ~1 pe alternanță la fiecare eșantion', () => {
    expect(zcrDin([1, 1, 1, 1])).toBe(0)
    expect(zcrDin([1, -1, 1, -1])).toBeCloseTo(1, 5)
  })
})

describe('poarta de voce — voce DA, zgomot/tăcere NU', () => {
  it('tăcerea NU deschide poarta niciodată', () => {
    const r = ruleaza(stareVadInitiala(0), rep(60, 0.003, 0.1))
    expect(r.deschideri).toBe(0)
  })

  it('vorbirea susținută DESCHIDE poarta (după onset)', () => {
    // Warm-up pe liniște, apoi voce clară (rms mare, ZCR mic).
    let st = ruleaza(stareVadInitiala(0), rep(25, 0.004, 0.1)).st
    const r = ruleaza(st, rep(15, 0.12, 0.1), 25 * PAS)
    expect(r.deschisUltim).toBe(true)
  })

  it('un pocnet scurt (< onset) NU deschide poarta', () => {
    const st = ruleaza(stareVadInitiala(0), rep(25, 0.004, 0.1)).st
    // 3 cadre tari (60 ms < onsetMs 120) apoi liniște.
    const r = ruleaza(st, [...rep(3, 0.2, 0.1), ...rep(20, 0.004, 0.1)], 25 * PAS)
    expect(r.deschideri).toBe(0)
  })

  it('HANGOVER: nu taie coada — rămâne deschis într-o pauză scurtă după vorbire', () => {
    let st = ruleaza(stareVadInitiala(0), rep(25, 0.004, 0.1)).st
    st = ruleaza(st, rep(15, 0.12, 0.1), 25 * PAS).st // deschide
    // 10 cadre de liniște (200 ms) < hangover 800 ms → încă deschis.
    const rScurt = ruleaza(st, rep(10, 0.004, 0.1), 40 * PAS)
    expect(rScurt.deschisUltim).toBe(true)
    // 50 cadre de liniște (1000 ms) > hangover → s-a închis.
    const rLung = ruleaza(st, rep(50, 0.004, 0.1), 40 * PAS)
    expect(rLung.deschisUltim).toBe(false)
  })

  it('zgomot de bandă largă TARE dar cu ZCR mare NU deschide (hiss ≠ voce)', () => {
    const st = ruleaza(stareVadInitiala(0), rep(25, 0.004, 0.1)).st
    const r = ruleaza(st, rep(20, 0.15, 0.5), 25 * PAS) // tare, dar ZCR 0.5 = hiss
    expect(r.deschideri).toBe(0)
  })

  it('zgomot CONSTANT (ventilator) intră în fond și NU deschide poarta', () => {
    // Zgomot staționar de la început: fondul se calibrează pe el → nu mai e „tare".
    const r = ruleaza(stareVadInitiala(0), rep(80, 0.05, 0.3))
    expect(r.deschideri).toBe(0)
  })

  it('o voce PESTE zgomotul constant tot deschide (prag adaptiv, nu absolut)', () => {
    let st = ruleaza(stareVadInitiala(0), rep(40, 0.05, 0.3)).st // fond ~0.05
    const r = ruleaza(st, rep(15, 0.25, 0.1), 40 * PAS) // voce clar peste fond
    expect(r.deschisUltim).toBe(true)
  })

  it('warm-up: stă închis cât se calibrează fondul, chiar dacă vine semnal', () => {
    // Primele cadre (sub incalzireMs 400) rămân închise chiar cu rms mare.
    const r = ruleaza(stareVadInitiala(0), rep(5, 0.2, 0.1)) // 100 ms < 400 ms
    expect(r.deschideri).toBe(0)
  })
})
