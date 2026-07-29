// ── TESTELE PĂRȚILOR DETERMINISTE DIN db.ts (2997 linii, ZERO teste) ────────
//
// Baza de date e cel mai mare fișier din soft. Majoritatea funcțiilor cer
// Postgres, dar bucățile care decid IDENTITATEA (amprenta vocală și cea de față)
// sunt matematică pură — și sunt și cele mai periculoase dacă greșesc:
// o distanță calculată prost înseamnă ori „nu te recunosc pe tine", ori, mult mai
// rău, „recunosc pe altcineva DREPT tine" (lacătul de admin se deschide pe voce).
//
// Verificăm și că fără DATABASE_URL nimic nu pretinde că merge.
import { describe, it, expect } from 'vitest'
import { vectorDistance, faceDistance, dbEnabled } from './db.js'

describe('db — distanța dintre amprente (identitatea userului)', () => {
  it('un vector cu EL ÎNSUȘI dă distanță 0 (recunoaștere perfectă)', () => {
    const v = [0.1, -0.4, 0.9, 0.25]
    expect(vectorDistance(v, v)).toBe(0)
    expect(faceDistance(v, v)).toBe(0)
  })

  it('cu cât diferă mai mult, cu atât distanța e mai mare (monoton)', () => {
    const a = [0, 0, 0, 0]
    const aproape = [0.1, 0, 0, 0]
    const departe = [1, 1, 1, 1]
    expect(vectorDistance(a, aproape)).toBeLessThan(vectorDistance(a, departe))
    expect(faceDistance(a, aproape)).toBeLessThan(faceDistance(a, departe))
  })

  it('e simetrică — cine compară pe cine nu contează', () => {
    const a = [0.2, 0.5, -0.3]
    const b = [-0.1, 0.4, 0.8]
    expect(vectorDistance(a, b)).toBeCloseTo(vectorDistance(b, a), 12)
    expect(faceDistance(a, b)).toBeCloseTo(faceDistance(b, a), 12)
  })

  it('vector gol → Infinity (NU 0): „nu știu cine ești", nu „ești tu"', () => {
    // Capcana care contează: dacă un vector gol ar da 0, orice prag l-ar accepta
    // ca potrivire perfectă — adică oricine ar trece drept owner.
    expect(vectorDistance([], [])).toBe(Infinity)
    expect(vectorDistance([1, 2], [])).toBe(Infinity)
    expect(faceDistance([], [1, 2])).toBe(Infinity)
  })

  it('lungimi diferite: compară doar cât se suprapune, fără să crape', () => {
    expect(Number.isFinite(vectorDistance([1, 2, 3], [1, 2]))).toBe(true)
    expect(Number.isFinite(faceDistance([1], [1, 9, 9]))).toBe(true)
  })

  it('valorile lipsă se tratează ca 0, nu ca NaN (NaN ar trece orice prag)', () => {
    const cuGoluri = [1, undefined as unknown as number, 3]
    expect(Number.isNaN(vectorDistance(cuGoluri, [1, 0, 3]))).toBe(false)
    expect(vectorDistance(cuGoluri, [1, 0, 3])).toBe(0)
  })

  it('cele două distanțe au scări DIFERITE, intenționat', () => {
    // vectorDistance e normalizată pe lungime (voce); faceDistance e brută
    // (convenția face-api, prag ~0,6). Dacă cineva le-ar unifica din greșeală,
    // pragurile de recunoaștere ar deveni greșite pe tăcute.
    const a = [1, 1, 1, 1]
    const b = [0, 0, 0, 0]
    expect(vectorDistance(a, b)).toBe(1) // sqrt(4/4)
    expect(faceDistance(a, b)).toBe(2) // sqrt(4)
  })
})

describe('db — fără DATABASE_URL nu se pretinde nimic', () => {
  it('dbEnabled spune adevărul despre configurare', () => {
    // În teste nu există DATABASE_URL → trebuie să fie fals, ca apelanții să
    // cadă pe căile lor de rezervă în loc să aștepte o bază inexistentă.
    expect(typeof dbEnabled()).toBe('boolean')
    expect(dbEnabled()).toBe(Boolean(process.env.DATABASE_URL))
  })
})
