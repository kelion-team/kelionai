import { describe, it, expect } from 'vitest'
import { descrieViteza, contextPentruCreier, vitezaDinPozitii } from './lib/contextOffline'

// ── CONTEXTUL OFFLINE (faza 2) — părțile PURE ───────────────────────────────
// Nu putem citi GPS/camera aici (doar pe device), dar contractul — viteza
// MĂSURATĂ, fără invenție (regula #1) — se probează pur.

describe('descrieViteza — treaptă umană din m/s, doar dacă e MĂSURATĂ', () => {
  it('viteză necunoscută → gol (nu inventează o cifră)', () => {
    expect(descrieViteza(null)).toBe('')
    expect(descrieViteza(undefined)).toBe('')
    expect(descrieViteza(Number.NaN)).toBe('')
    expect(descrieViteza(-1)).toBe('')
  })
  it('clasifică pe loc / pe jos / vehicul, cu cifra reală în km/h', () => {
    expect(descrieViteza(0)).toBe('stationary')
    expect(descrieViteza(1.4)).toContain('walking') // ~5 km/h
    expect(descrieViteza(1.4)).toContain('5 km/h')
    expect(descrieViteza(25)).toContain('vehicle') // ~90 km/h
    expect(descrieViteza(25)).toContain('90 km/h')
    expect(descrieViteza(250)).toContain('plane') // ~900 km/h
  })
})

describe('contextPentruCreier — doar ce e MĂSURAT, gol dacă nimic', () => {
  it('fără niciun semnal → gol', () => {
    expect(contextPentruCreier({})).toBe('')
    expect(contextPentruCreier({ vitezaMs: null })).toBe('')
  })
  it('adună locația, viteza și vederea, și interzice invenția', () => {
    const c = contextPentruCreier({ lat: 51.5, lon: -0.12, vitezaMs: 25, fataDetectata: true, expresie: 'tired' })
    expect(c).toContain('51.5000, -0.1200')
    expect(c).toContain('90 km/h')
    expect(c).toContain('looks tired')
    expect(c).toMatch(/never invent/i)
  })
  it('viteză necunoscută nu apare în context', () => {
    const c = contextPentruCreier({ lat: 44, lon: 26, vitezaMs: null })
    expect(c).toContain('location')
    expect(c).not.toContain('movement')
  })
})

describe('vitezaDinPozitii — fallback când senzorul nu dă speed', () => {
  it('două poziții + interval → m/s (haversine/dt)', () => {
    // ~111 m pe latitudine la 0.001°, în 10s → ~11 m/s
    const v = vitezaDinPozitii({ lat: 51.5, lon: 0, t: 0 }, { lat: 51.501, lon: 0, t: 10_000 })
    expect(v).not.toBeNull()
    expect(v!).toBeGreaterThan(9)
    expect(v!).toBeLessThan(13)
  })
  it('interval prea mic → null (nu inventează)', () => {
    expect(vitezaDinPozitii({ lat: 51.5, lon: 0, t: 0 }, { lat: 51.5, lon: 0, t: 100 })).toBeNull()
  })
})
