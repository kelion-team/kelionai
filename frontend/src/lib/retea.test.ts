// ── DETECȚIA ȚEVII + CALITATE ADAPTIVĂ ──────────────────────────────────────
//
// Owner (12 aug): „test care vede ce țeavă se folosește și comută calitatea
// dinamic?". Partea PURĂ (clasificarea + profilul de calitate) se probează aici
// real; citirea din `navigator.connection` e I/O de browser, nu se testează cu
// unitate. Regula #1: fără niciun semnal → `necunoscut` = EXACT calitatea de azi
// (nicio regresie pe Safari/iOS/Firefox unde API-ul lipsește).
import { describe, it, expect } from 'vitest'
import { clasificaTeava, calitateCamera, etichetaTeava, type Teava } from './retea'

describe('clasificaTeava — treapta din semnalele browserului', () => {
  it('2G / slow-2G = slabă', () => {
    expect(clasificaTeava({ effectiveType: '2g' })).toBe('slab')
    expect(clasificaTeava({ effectiveType: 'slow-2g' })).toBe('slab')
  })
  it('3G = medie', () => {
    expect(clasificaTeava({ effectiveType: '3g' })).toBe('mediu')
  })
  it('4G bun = bun, dar 4G cu debit mic / RTT mare = de fapt mediu (cifrele bat eticheta)', () => {
    expect(clasificaTeava({ effectiveType: '4g', downlink: 10, rtt: 40 })).toBe('bun')
    expect(clasificaTeava({ effectiveType: '4g', downlink: 0.6 })).toBe('mediu')
    expect(clasificaTeava({ effectiveType: '4g', rtt: 700 })).toBe('mediu')
  })
  it('saveData bate tot — omul a cerut economie', () => {
    expect(clasificaTeava({ effectiveType: '4g', downlink: 20, saveData: true })).toBe('slab')
  })
  it('fără effectiveType dar cu downlink/rtt măsurate', () => {
    expect(clasificaTeava({ downlink: 0.3 })).toBe('slab')
    expect(clasificaTeava({ rtt: 900 })).toBe('slab')
    expect(clasificaTeava({ downlink: 1.5 })).toBe('mediu')
    expect(clasificaTeava({ downlink: 8, rtt: 40 })).toBe('bun')
  })
  it('fără NICIUN semnal (API absent) → necunoscut', () => {
    expect(clasificaTeava({})).toBe('necunoscut')
  })
})

describe('calitateCamera — bun/necunoscut = comportamentul de azi, slab/mediu mai ușor', () => {
  it('necunoscut și bun păstrează 512 / 0.6 / 4 (nicio regresie)', () => {
    for (const t of ['bun', 'necunoscut'] as Teava[]) {
      expect(calitateCamera(t)).toEqual({ maxDim: 512, jpeg: 0.6, cadre: 4 })
    }
  })
  it('mediu scade dimensiunea/calitatea/cadrele', () => {
    expect(calitateCamera('mediu')).toEqual({ maxDim: 448, jpeg: 0.5, cadre: 2 })
  })
  it('slab e cel mai ușor (un singur cadru)', () => {
    const c = calitateCamera('slab')
    expect(c.cadre).toBe(1)
    expect(c.maxDim).toBeLessThan(512)
    expect(c.jpeg).toBeLessThan(0.6)
  })
  it('calitatea nu crește niciodată peste treapta bună', () => {
    for (const t of ['slab', 'mediu', 'bun', 'necunoscut'] as Teava[]) {
      const c = calitateCamera(t)
      expect(c.maxDim).toBeLessThanOrEqual(512)
      expect(c.jpeg).toBeLessThanOrEqual(0.6)
      expect(c.cadre).toBeLessThanOrEqual(4)
      expect(c.cadre).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('etichetaTeava — text pentru om/creier', () => {
  it('fiecare treaptă are o etichetă nevidă și distinctă', () => {
    const et = (['slab', 'mediu', 'bun', 'necunoscut'] as Teava[]).map(etichetaTeava)
    expect(new Set(et).size).toBe(4)
    for (const e of et) expect(e.length).toBeGreaterThan(3)
  })
})
