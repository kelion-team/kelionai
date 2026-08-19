import { describe, it, expect } from 'vitest'
import { verdictPulsLucrator } from './services/pulsLucrator.js'

// owner, 19 aug: „are ordine in coada dar nu se apuca aider… de ce?" — panoul
// trebuie să arate MĂSURAT dacă lucrătorul de pe VPS mai cere ordine.
describe('verdictPulsLucrator — pulsul lucrătorului constructorului', () => {
  const acum = 1_700_000_000_000

  it('bătaie recentă (sub prag) → VIU, cu vârsta în secunde', () => {
    const r = verdictPulsLucrator(acum - 30_000, acum)
    expect(r.viu).toBe(true)
    expect(r.ageSec).toBe(30)
    expect(r.lastPoll).toBe(acum - 30_000)
  })

  it('bătaie veche (peste prag 5 min) → MORT', () => {
    const r = verdictPulsLucrator(acum - 11 * 60_000, acum)
    expect(r.viu).toBe(false)
    expect(r.ageSec).toBe(660)
  })

  it('exact pe prag = mort (a trecut deja fereastra)', () => {
    const r = verdictPulsLucrator(acum - 5 * 60_000, acum, 5 * 60_000)
    expect(r.viu).toBe(false)
  })

  it('niciodată (0 / invalid) → MORT, ageSec null (nu inventează o vârstă)', () => {
    expect(verdictPulsLucrator(0, acum)).toEqual({ lastPoll: 0, ageSec: null, viu: false, pragMs: 5 * 60_000 })
    expect(verdictPulsLucrator(NaN, acum).viu).toBe(false)
    expect(verdictPulsLucrator(-5, acum).lastPoll).toBe(0)
  })

  it('prag configurabil respectat', () => {
    expect(verdictPulsLucrator(acum - 90_000, acum, 60_000).viu).toBe(false)
    expect(verdictPulsLucrator(acum - 30_000, acum, 60_000).viu).toBe(true)
  })

  it('ceas care a sărit înapoi → vârstă 0, nu negativă', () => {
    const r = verdictPulsLucrator(acum + 5_000, acum)
    expect(r.ageSec).toBe(0)
    expect(r.viu).toBe(true)
  })
})
