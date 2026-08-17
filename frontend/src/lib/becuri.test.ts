import { describe, it, expect } from 'vitest'
import { clasaBec } from './admin'

// Owner, 13 aug: „când e gol becul pâlpâie roșu". Regula, bătută în cuie: DOAR
// roșul (gol / 402 — acolo trebuie pus credit) pâlpâie; verde și gri stau
// liniștite. Dacă cineva scoate pâlpâirea sau o pune pe verde, testul cade.
describe('clasaBec — doar roșul (gol) pâlpâie', () => {
  it('roșu primește clasa de pâlpâire', () => {
    expect(clasaBec('rosu')).toBe('bec bec-rosu palpaie')
  })
  it('verde NU pâlpâie', () => {
    expect(clasaBec('verde')).toBe('bec bec-verde')
  })
  it('gri (necunoscut) NU pâlpâie', () => {
    expect(clasaBec('gri')).toBe('bec bec-gri')
  })
})
