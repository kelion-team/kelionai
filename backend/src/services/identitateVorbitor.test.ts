import { describe, it, expect } from 'vitest'
import { verdictVorbitor, FEREASTRA_CONFIRMARE_MS } from './identitateVorbitor.js'

// ── VERDICTUL VORBITORULUI — garda securității per-frază ──────────────────────
// Cerința (Adrian, 5 aug, „maximă securitate"): la fiecare frază se decide dacă
// vorbește titularul, un oaspete cunoscut, sau un străin. „Orice voce = titular"
// e EXACT ce trebuie să NU se mai întâmple. Testele astea țin regula la bit.

const T0 = 1_000_000_000_000 // ancoră de timp fixă (fără Date.now în teste)

describe('verdictVorbitor', () => {
  it('voce potrivită → TITULAR (confirmat acum)', () => {
    const r = verdictVorbitor({
      vocePotrivita: true,
      fataPotrivita: null,
      oaspeteCunoscut: false,
      confirmatTitularLa: 0,
      acum: T0,
      fereastraMs: FEREASTRA_CONFIRMARE_MS,
    })
    expect(r).toEqual({ verdict: 'titular', peFereastra: false })
  })

  it('față potrivită (fără voce) → TITULAR', () => {
    const r = verdictVorbitor({
      vocePotrivita: null,
      fataPotrivita: true,
      oaspeteCunoscut: false,
      confirmatTitularLa: 0,
      acum: T0,
      fereastraMs: FEREASTRA_CONFIRMARE_MS,
    })
    expect(r.verdict).toBe('titular')
  })

  it('mostră care NU se potrivește + oaspete cunoscut → OASPETE', () => {
    const r = verdictVorbitor({
      vocePotrivita: false,
      fataPotrivita: null,
      oaspeteCunoscut: true,
      confirmatTitularLa: T0 - 1000, // chiar dacă titularul a fost confirmat acum o secundă
      acum: T0,
      fereastraMs: FEREASTRA_CONFIRMARE_MS,
    })
    expect(r).toEqual({ verdict: 'oaspete', peFereastra: false })
  })

  it('mostră care NU se potrivește + necunoscut → STRĂIN (chiar în fereastra titularului)', () => {
    // Cheia securității: un impostor NU moștenește fereastra titularului.
    const r = verdictVorbitor({
      vocePotrivita: false,
      fataPotrivita: null,
      oaspeteCunoscut: false,
      confirmatTitularLa: T0 - 1000,
      acum: T0,
      fereastraMs: FEREASTRA_CONFIRMARE_MS,
    })
    expect(r).toEqual({ verdict: 'strain', peFereastra: false })
  })

  it('fără mostră, dar titular confirmat recent → TITULAR pe fereastră', () => {
    const r = verdictVorbitor({
      vocePotrivita: null,
      fataPotrivita: null,
      oaspeteCunoscut: false,
      confirmatTitularLa: T0 - 60_000, // acum un minut
      acum: T0,
      fereastraMs: FEREASTRA_CONFIRMARE_MS,
    })
    expect(r).toEqual({ verdict: 'titular', peFereastra: true })
  })

  it('fără mostră ȘI fereastra expirată → STRĂIN (nu „orice tăcere = titular")', () => {
    const r = verdictVorbitor({
      vocePotrivita: null,
      fataPotrivita: null,
      oaspeteCunoscut: false,
      confirmatTitularLa: T0 - FEREASTRA_CONFIRMARE_MS - 1, // chiar peste fereastră
      acum: T0,
      fereastraMs: FEREASTRA_CONFIRMARE_MS,
    })
    expect(r).toEqual({ verdict: 'strain', peFereastra: false })
  })

  it('fără mostră ȘI niciodată confirmat → STRĂIN', () => {
    const r = verdictVorbitor({
      vocePotrivita: null,
      fataPotrivita: null,
      oaspeteCunoscut: false,
      confirmatTitularLa: 0,
      acum: T0,
      fereastraMs: FEREASTRA_CONFIRMARE_MS,
    })
    expect(r.verdict).toBe('strain')
  })
})
