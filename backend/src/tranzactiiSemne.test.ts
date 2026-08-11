import { describe, it, expect } from 'vitest'
import { curataSemne, curataZone } from './routes/tranzactii.js'

// POINTERII DE INDICAȚIE (10 aug, ownerul: „el când explică trebuie să arate
// clar pe monitor ce zice, adică poziționează pointeri de indicație"). Curățarea
// pointerilor veniți de la creier (unealta arata_pe_grafic) e PURĂ — se probează
// aici fără browser, ca nimic inventat/stricat să nu ajungă pe graficul omului.
describe('curataSemne — pointerii de pe grafic', () => {
  it('păstrează doar prețuri reale, pozitive', () => {
    expect(
      curataSemne([
        { pret: 65100, tip: 'rezistenta', text: 'respinsă de 2 ori' },
        { pret: -1, tip: 'suport' },
        { pret: 0 },
        { pret: 'aiurea' },
        { pret: NaN },
      ]),
    ).toEqual([{ pret: 65100, tip: 'rezistenta', text: 'respinsă de 2 ori' }])
  })

  it('tip necunoscut sau lipsă devine „nota"', () => {
    expect(curataSemne([{ pret: 100, tip: 'inventat' }])).toEqual([{ pret: 100, tip: 'nota', text: '' }])
    expect(curataSemne([{ pret: 100 }])).toEqual([{ pret: 100, tip: 'nota', text: '' }])
  })

  it('acceptă diacriticele în tip (rezistență → rezistenta, țintă → tinta)', () => {
    expect(curataSemne([{ pret: 5, tip: 'rezistență' }])[0].tip).toBe('rezistenta')
    expect(curataSemne([{ pret: 5, tip: 'ȚINTĂ' }])[0].tip).toBe('tinta')
  })

  it('taie eticheta la 60 de caractere și limitează la 8 pointeri', () => {
    const lung = 'x'.repeat(80)
    expect(curataSemne([{ pret: 1, text: lung }])[0].text.length).toBe(60)
    const multe = Array.from({ length: 20 }, (_, i) => ({ pret: i + 1 }))
    expect(curataSemne(multe).length).toBe(8)
  })

  it('input ne-array → listă goală (nu crapă, nu inventează)', () => {
    expect(curataSemne(null)).toEqual([])
    expect(curataSemne(undefined)).toEqual([])
    expect(curataSemne('nu-i array')).toEqual([])
    expect(curataSemne([null, undefined, 42])).toEqual([])
  })
})

// ZONE (benzi de preț) — a doua funcție vizuală: o bandă între două prețuri.
describe('curataZone — benzile de preț de pe grafic', () => {
  it('normalizează marginile (jos = minimul, sus = maximul)', () => {
    expect(curataZone([{ pret1: 65100, pret2: 63000, tip: 'suport', text: 'acumulare' }])).toEqual([
      { jos: 63000, sus: 65100, tip: 'suport', text: 'acumulare' },
    ])
  })

  it('aruncă zonele invalide (preț ne-real, ≤0 sau margini egale)', () => {
    expect(curataZone([{ pret1: 0, pret2: 100 }])).toEqual([])
    expect(curataZone([{ pret1: 100, pret2: 100 }])).toEqual([]) // bandă cu grosime 0
    expect(curataZone([{ pret1: 'x', pret2: 100 }])).toEqual([])
    expect(curataZone([{ pret1: 100 }])).toEqual([])
  })

  it('tip necunoscut devine „nota", eticheta se taie la 60, max 6 zone', () => {
    expect(curataZone([{ pret1: 1, pret2: 2, tip: 'inventat' }])[0].tip).toBe('nota')
    expect(curataZone([{ pret1: 1, pret2: 2, text: 'x'.repeat(80) }])[0].text.length).toBe(60)
    const multe = Array.from({ length: 20 }, (_, i) => ({ pret1: i + 1, pret2: i + 2 }))
    expect(curataZone(multe).length).toBe(6)
  })

  it('input ne-array → listă goală', () => {
    expect(curataZone(null)).toEqual([])
    expect(curataZone('nope')).toEqual([])
    expect(curataZone([null, 7])).toEqual([])
  })
})
