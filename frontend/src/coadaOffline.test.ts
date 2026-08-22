import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  necesitaNet,
  anuntAmanat,
  adaugaTuraSync,
  citesteSync,
  golesteSync,
  adaugaAmanata,
  citesteAmanate,
  stergeAmanata,
} from './lib/coadaOffline'

// localStorage nu există în node → îl mockăm ca să probăm cozile.
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
})

beforeEach(() => store.clear())

describe('necesitaNet — cine are nevoie de net (euristică, best-effort)', () => {
  it('cererile care cer net → true', () => {
    expect(necesitaNet('caută vremea în Londra')).toBe(true)
    expect(necesitaNet('trimite un email lui Adrian')).toBe(true)
    expect(necesitaNet('care e cursul valutar acum')).toBe(true)
    expect(necesitaNet('dă-mi ruta spre casă')).toBe(true)
  })
  it('conversația simplă → false (o rezolvă creierul local)', () => {
    expect(necesitaNet('salut, ce faci?')).toBe(false)
    expect(necesitaNet('spune-mi o glumă')).toBe(false)
    expect(necesitaNet('')).toBe(false)
  })
})

describe('anuntAmanat — anunțul civilizat la rezolvare', () => {
  it('conține introul în limba userului + întrebarea + răspunsul', () => {
    const a = anuntAmanat('care e vremea?', 'E însorit, 22°C.', 'ro')
    expect(a).toContain('Îți pot spune acum')
    expect(a).toContain('care e vremea?')
    expect(a).toContain('E însorit, 22°C.')
  })
})

describe('coada SYNC — ce s-a întâmplat offline, pentru server', () => {
  it('adaugă, citește și golește', () => {
    expect(citesteSync()).toEqual([])
    adaugaTuraSync({ rol: 'user', text: 'salut offline', t: 1 })
    adaugaTuraSync({ rol: 'assistant', text: 'sunt cu tine', t: 2 })
    expect(citesteSync()).toHaveLength(2)
    expect(citesteSync()[0]).toMatchObject({ rol: 'user', text: 'salut offline' })
    golesteSync()
    expect(citesteSync()).toEqual([])
  })
})

describe('coada AMÂNATE — cererile ce cer net, rezolvate la revenire', () => {
  it('adaugă cu id, citește și șterge punctual', () => {
    const c1 = adaugaAmanata({ intrebare: 'vremea?', t: 100 })
    const c2 = adaugaAmanata({ intrebare: 'știrile?', t: 200 })
    expect(citesteAmanate()).toHaveLength(2)
    expect(c1.id).not.toBe(c2.id)
    stergeAmanata(c1.id)
    const ramase = citesteAmanate()
    expect(ramase).toHaveLength(1)
    expect(ramase[0].intrebare).toBe('știrile?')
  })
})
