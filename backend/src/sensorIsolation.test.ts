import { describe, expect, it, vi } from 'vitest'

vi.mock('./db.js', () => ({ addMemory: vi.fn(async () => undefined) }))

import {
  adaugaEvenimentSonor,
  evenimenteSonoreRecente,
  valideazaEvenimentSonor,
} from './services/auzAmbiental.js'

const A = 'a@example.com'
const B = 'b@example.com'

describe('izolarea și validarea contextului senzorial', () => {
  it('nu permite transferul contextului sonor între utilizatori', () => {
    const acum = Date.now()
    adaugaEvenimentSonor(A, { ts: acum, tip: 'zgomot_brusc', intensitate: 90, durataMs: 500, frecventaDominanta: 800 })

    expect(evenimenteSonoreRecente(A)).toHaveLength(1)
    expect(evenimenteSonoreRecente(B)).toEqual([])
  })

  it('respinge tipuri/timestampuri invalide și clamp-uiește metricile finite', () => {
    const acum = Date.now()
    expect(valideazaEvenimentSonor({ tip: 'injectat', ts: acum }, acum)).toMatchObject({ ok: false, error: 'tip_invalid' })
    expect(valideazaEvenimentSonor({ tip: 'zgomot_brusc', ts: acum + 120_000 }, acum)).toMatchObject({ ok: false, error: 'timestamp_invalid' })
    expect(valideazaEvenimentSonor({ tip: 'zgomot_brusc', intensitate: Number.NaN }, acum)).toMatchObject({ ok: false })
    expect(valideazaEvenimentSonor({ tip: 'zgomot_brusc', intensitate: 200, durataMs: -1, frecventaDominanta: 99_999 }, acum))
      .toMatchObject({ ok: true, valoare: { intensitate: 100, durataMs: 0, frecventaDominanta: 24_000 } })
  })
})
