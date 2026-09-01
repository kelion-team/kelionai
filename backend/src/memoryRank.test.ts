import { describe, it, expect } from 'vitest'
import {
  normalizeazaTip,
  clampImportanta,
  importantaImplicita,
  injumatatireMsPeTip,
  decadereInTimp,
  esteExpirata,
  scorMemorie,
  rangheazaMemorii,
  type MemorieDeRangat,
} from './services/memoryRank.js'

// ── MEMORIE SMART (owner, 19 aug: „schimba... cu toate atuurile") ────────────
// Nucleul PUR al rangării: tip → importanță/înjumătățire, decădere-în-timp,
// expirare, și scorul combinat similaritate × importanță × prospețime. Probat
// pe date, fără DB, fără rețea — regula măsurătorii: comportamentul se dovedește.
const ZI = 24 * 60 * 60 * 1000

describe('tipuri + importanță implicită', () => {
  it('normalizează doar tipurile cunoscute; restul → null (memorie generică)', () => {
    expect(normalizeazaTip('identity')).toBe('identity')
    expect(normalizeazaTip('PREFERENCE')).toBe('preference')
    expect(normalizeazaTip('habar-n-am')).toBeNull()
    expect(normalizeazaTip(null)).toBeNull()
  })

  it('identitatea/preferința cântăresc mai mult decât un episod', () => {
    expect(importantaImplicita('identity')).toBeGreaterThan(importantaImplicita('fact'))
    expect(importantaImplicita('fact')).toBeGreaterThan(importantaImplicita('episodic'))
  })

  it('clampImportanta: valid → mărginit [0,1]; absent/nevalid → implicita tipului', () => {
    expect(clampImportanta(0.7, 'fact')).toBe(0.7)
    expect(clampImportanta(5, 'fact')).toBe(1)
    expect(clampImportanta(-2, 'fact')).toBe(0)
    expect(clampImportanta(undefined, 'identity')).toBe(importantaImplicita('identity'))
    expect(clampImportanta('nu-i număr', null)).toBe(importantaImplicita(null))
  })
})

describe('uitarea în timp (decădere)', () => {
  it('memorie proaspătă = 1; la o înjumătățire = 0,5; mult mai bătrână → spre 0', () => {
    const h = injumatatireMsPeTip('fact')
    expect(decadereInTimp(0, h)).toBe(1)
    expect(decadereInTimp(h, h)).toBeCloseTo(0.5, 5)
    expect(decadereInTimp(3 * h, h)).toBeCloseTo(0.125, 5)
  })

  it('identitatea se uită mult mai încet decât un episod', () => {
    // La 30 de zile, un episod e deja pe jumătate uitat; identitatea e ~intactă.
    const episod = decadereInTimp(30 * ZI, injumatatireMsPeTip('episodic'))
    const identitate = decadereInTimp(30 * ZI, injumatatireMsPeTip('identity'))
    expect(episod).toBeLessThan(0.55)
    expect(identitate).toBeGreaterThan(0.98)
  })
})

describe('expirarea', () => {
  it('o memorie cu expires trecut NU se mai reamintește (scor 0, exclusă)', () => {
    const acum = 1_000_000
    expect(esteExpirata(acum - 1, acum)).toBe(true)
    expect(esteExpirata(acum + 1, acum)).toBe(false)
    expect(esteExpirata(null, acum)).toBe(false)
  })
})

const mem = (o: Partial<MemorieDeRangat>): MemorieDeRangat => ({
  content: o.content ?? 'x',
  tip: o.tip ?? null,
  importanta: o.importanta ?? 0.5,
  semantic: o.semantic ?? 0,
  varstaMs: o.varstaMs ?? 0,
  expiresAtMs: o.expiresAtMs ?? null,
})

describe('scorul combinat + rangarea', () => {
  const acum = 10 * 365 * ZI // un „acum" mare, ca varstaMs să fie pozitiv oriunde

  it('la aceeași similaritate, memoria mai IMPORTANTĂ iese prima', () => {
    const importanta = mem({ content: 'imp', semantic: 0.8, importanta: 0.95, tip: 'identity' })
    const banala = mem({ content: 'ban', semantic: 0.8, importanta: 0.3, tip: 'episodic' })
    expect(scorMemorie(importanta, acum)).toBeGreaterThan(scorMemorie(banala, acum))
  })

  it('la aceeași importanță, memoria mai RELEVANTĂ (semantic) iese prima', () => {
    const relevanta = mem({ content: 'rel', semantic: 0.9, importanta: 0.6 })
    const off = mem({ content: 'off', semantic: 0.5, importanta: 0.6 })
    expect(scorMemorie(relevanta, acum)).toBeGreaterThan(scorMemorie(off, acum))
  })

  it('la egalitate de sim+imp, memoria mai PROASPĂTĂ iese prima', () => {
    const proaspata = mem({ content: 'nou', semantic: 0.7, importanta: 0.6, tip: 'fact', varstaMs: 0 })
    const veche = mem({ content: 'vechi', semantic: 0.7, importanta: 0.6, tip: 'fact', varstaMs: 3 * 365 * ZI })
    expect(scorMemorie(proaspata, acum)).toBeGreaterThan(scorMemorie(veche, acum))
  })

  it('rangheazaMemorii: exclude expiratele, sortează pe scor, taie la limit', () => {
    const acum2 = 1_000_000_000_000
    const lista = [
      mem({ content: 'expirata', semantic: 0.99, importanta: 1, expiresAtMs: acum2 - 1 }),
      mem({ content: 'a', semantic: 0.9, importanta: 0.9, tip: 'identity' }),
      mem({ content: 'b', semantic: 0.6, importanta: 0.4, tip: 'episodic' }),
      mem({ content: 'c', semantic: 0.5, importanta: 0.5, tip: 'fact' }),
    ]
    const top = rangheazaMemorii(lista, acum2, 2)
    expect(top).toHaveLength(2)
    expect(top.map((m) => m.content)).not.toContain('expirata') // expirata nu apare, deși are sim 0.99
    expect(top[0].content).toBe('a') // cea mai importantă + relevantă
  })
})
