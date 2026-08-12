// ── L1e: PROCESAREA DE DATE TABELARE — CONTRACTUL MĂSURAT ────────────────────
//
// Regula #1 a proiectului: nimic inventat. Testul păzește exact asta pe date:
//   - un câmp devine număr DOAR cu tipar clar (en/ro/mii/procent), altfel text;
//   - o agregare fără nicio valoare numerică dă „—" (null), NU 0 fabricat;
//   - CSV real (ghilimele, virgule și nou-rânduri în interior, „" escapat);
//   - erorile vin NUMITE (coloană inexistentă, operație necunoscută), nu tăcute.
import { describe, it, expect } from 'vitest'
import {
  parseCSV,
  laNumar,
  parseTabel,
  agrega,
  profil,
  formatDoc,
  EroareDate,
} from './dateTabelare.js'

describe('laNumar — numărul se recunoaște, nu se ghicește', () => {
  it('întreg, zecimal en și ro', () => {
    expect(laNumar('42')).toBe(42)
    expect(laNumar('-3')).toBe(-3)
    expect(laNumar('1234.56')).toBe(1234.56)
    expect(laNumar('1234,56')).toBe(1234.56)
  })
  it('separatori de mii (en și ro) și procent', () => {
    expect(laNumar('1,234.56')).toBe(1234.56)
    expect(laNumar('1.234,56')).toBe(1234.56)
    expect(laNumar('42%')).toBe(42)
  })
  it('ce nu e clar numeric rămâne text (null)', () => {
    expect(laNumar('abc')).toBeNull()
    expect(laNumar('12abc')).toBeNull()
    expect(laNumar('')).toBeNull()
    expect(laNumar('1.2.3')).toBeNull()
  })
})

describe('parseCSV — CSV real, nu split pe virgulă', () => {
  it('ghilimele cu virgulă și nou-rând în interior + "" escapat', () => {
    const csv = 'nume,nota\n"Ion, jr.","zice ""ok""\nrand2"\nMaria,2'
    const m = parseCSV(csv)
    expect(m[0]).toEqual(['nume', 'nota'])
    expect(m[1][0]).toBe('Ion, jr.')
    expect(m[1][1]).toBe('zice "ok"\nrand2')
    expect(m[2]).toEqual(['Maria', '2'])
  })
  it('detectează delimitatorul „;"', () => {
    const m = parseCSV('a;b;c\n1;2;3')
    expect(m[0]).toEqual(['a', 'b', 'c'])
    expect(m[1]).toEqual(['1', '2', '3'])
  })
})

describe('parseTabel — CSV și JSON, tipuri oneste', () => {
  it('CSV: antet + tipizare numerică pe celule', () => {
    const t = parseTabel('produs,pret,stoc\nmar,3.5,10\npara,,0')
    expect(t.format).toBe('csv')
    expect(t.coloane).toEqual(['produs', 'pret', 'stoc'])
    expect(t.randuri[0]).toEqual({ produs: 'mar', pret: 3.5, stoc: 10 })
    // câmp gol → null (nu 0), nu se inventează
    expect(t.randuri[1].pret).toBeNull()
    expect(t.randuri[1].stoc).toBe(0)
  })
  it('CSV cu anteturi duplicate → sufixate, nu suprascrise', () => {
    const t = parseTabel('a,a,b\n1,2,3')
    expect(t.coloane).toEqual(['a', 'a_2', 'b'])
    expect(t.randuri[0]).toEqual({ a: 1, a_2: 2, b: 3 })
  })
  it('JSON: array de obiecte, uniunea cheilor', () => {
    const t = parseTabel('[{"x":1,"y":"a"},{"x":2,"z":true}]')
    expect(t.format).toBe('json')
    expect(t.coloane).toEqual(['x', 'y', 'z'])
    expect(t.randuri[0]).toEqual({ x: 1, y: 'a', z: null })
    expect(t.randuri[1]).toEqual({ x: 2, y: null, z: 'true' })
  })
  it('JSON: NDJSON (un obiect pe linie)', () => {
    const t = parseTabel('{"a":1}\n{"a":2}', 'json')
    expect(t.randuri.map((r) => r.a)).toEqual([1, 2])
  })
  it('JSON: obiect cu o proprietate-array', () => {
    const t = parseTabel('{"total":2,"items":[{"n":1},{"n":2}]}')
    expect(t.coloane).toEqual(['n'])
    expect(t.randuri).toHaveLength(2)
  })
  it('date goale sau invalide → EroareDate NUMITĂ', () => {
    expect(() => parseTabel('')).toThrow(EroareDate)
    expect(() => parseTabel('{nu e json', 'json')).toThrow(EroareDate)
  })
})

describe('agrega — calcul măsurat, gol = „—" nu 0', () => {
  const t = parseTabel('regiune,vanzari\nnord,100\nsud,50\nnord,25\nsud,')
  it('sumă grupată, ordonată descrescător', () => {
    const r = agrega(t, { operatie: 'suma', valoare: 'vanzari', grupeaza_dupa: 'regiune' })
    expect(r.rezultate[0]).toEqual({ cheie: 'nord', rezultat: 125, n: 2 })
    expect(r.rezultate[1]).toEqual({ cheie: 'sud', rezultat: 50, n: 1 }) // celula goală NU intră (n=1)
  })
  it('medie pe tot tabelul, doar pe valori numerice reale', () => {
    const r = agrega(t, { operatie: 'medie', valoare: 'vanzari' })
    // (100+50+25)/3 — rândul gol nu contează
    expect(r.rezultate[0].rezultat).toBeCloseTo(58.3333, 3)
    expect(r.rezultate[0].n).toBe(3)
  })
  it('numar = câte rânduri, numar_unic = distincte', () => {
    expect(agrega(t, { operatie: 'numar' }).rezultate[0]).toEqual({ cheie: '(total)', rezultat: 4, n: 4 })
    expect(agrega(t, { operatie: 'numar_unic', valoare: 'regiune' }).rezultate[0].rezultat).toBe(2)
  })
  it('sumă pe o coloană FĂRĂ valori numerice → null (nu 0 inventat)', () => {
    const t2 = parseTabel('nume\nion\nmaria')
    const r = agrega(t2, { operatie: 'suma', valoare: 'nume' })
    expect(r.rezultate[0]).toEqual({ cheie: '(total)', rezultat: null, n: 0 })
  })
  it('erori NUMITE: coloană inexistentă, operație fără valoare', () => {
    expect(() => agrega(t, { operatie: 'suma', valoare: 'inexistenta' })).toThrow(EroareDate)
    expect(() => agrega(t, { operatie: 'suma' })).toThrow(EroareDate)
    // @ts-expect-error operație în afara enum-ului
    expect(() => agrega(t, { operatie: 'radacina', valoare: 'vanzari' })).toThrow(EroareDate)
  })
})

describe('profil — tip inferat din date, statistici doar pe numeric', () => {
  it('coloană numerică vs text, min/max/sumă/medie', () => {
    const t = parseTabel('nume,scor\nA,10\nB,20\nC,30')
    const p = profil(t)
    expect(p.randuri).toBe(3)
    const scor = p.coloane.find((c) => c.nume === 'scor')!
    expect(scor.tip).toBe('numar')
    expect(scor.min).toBe(10)
    expect(scor.max).toBe(30)
    expect(scor.suma).toBe(60)
    expect(scor.medie).toBe(20)
    const nume = p.coloane.find((c) => c.nume === 'nume')!
    expect(nume.tip).toBe('text')
    expect(nume.suma).toBeUndefined()
  })
})

describe('formatDoc — tabel citibil, cap pe rânduri', () => {
  it('antet + separator + rânduri, iar restul e NUMIT nu tăcut', () => {
    const randuri = Array.from({ length: 5 }, (_, i) => `r${i},${i}`).join('\n')
    const t = parseTabel(`a,b\n${randuri}`)
    const doc = formatDoc(t, 2)
    expect(doc).toContain('a')
    expect(doc).toContain('… încă 3 rânduri (5 în total)')
  })
})
