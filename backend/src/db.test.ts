// ── TESTS FOR THE DETERMINISTIC PARTS OF db.ts (2997 lines, ZERO tests) ────
//
// The database is the biggest file in the software. Most functions require
// Postgres, but the pieces that decide IDENTITY (the voice and face
// fingerprints) are pure math — and also the most dangerous if they go wrong:
// a badly computed distance means either "I don't recognize you", or, much
// worse, "I recognize someone else AS you" (the admin padlock opens on
// voice).
//
// We also check that without DATABASE_URL nothing pretends to work.
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
    // The trap that matters: if an empty vector gave 0, any threshold would
    // accept it as a perfect match — meaning anyone would pass as the owner.
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
    // vectorDistance is length-normalized (voice); faceDistance is raw (the
    // face-api convention, threshold ~0.6). If someone unified them by
    // mistake, the recognition thresholds would silently become wrong.
    const a = [1, 1, 1, 1]
    const b = [0, 0, 0, 0]
    expect(vectorDistance(a, b)).toBe(1) // sqrt(4/4)
    expect(faceDistance(a, b)).toBe(2) // sqrt(4)
  })
})

describe('db — fără DATABASE_URL nu se pretinde nimic', () => {
  it('dbEnabled spune adevărul despre configurare', () => {
    // In tests there is no DATABASE_URL → it must be false, so callers fall
    // onto their fallback paths instead of waiting for a nonexistent
    // database.
    expect(typeof dbEnabled()).toBe('boolean')
    expect(dbEnabled()).toBe(Boolean(process.env.DATABASE_URL))
  })
})
