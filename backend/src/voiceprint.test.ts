import { describe, it, expect } from 'vitest'
import { inferGender } from './routes/voiceprint.js'
import { vectorDistance } from './db.js'

describe('inferGender', () => {
  it('classifica vocile grave ca barbati', () => {
    expect(inferGender(120)).toBe('male')
    expect(inferGender(80)).toBe('male')
    expect(inferGender(144)).toBe('male')
  })

  it('classifica vocile inalte ca femei', () => {
    expect(inferGender(180)).toBe('female')
    expect(inferGender(250)).toBe('female')
    expect(inferGender(176)).toBe('female')
  })

  it('marcheaza zona intermediara ca necunoscuta', () => {
    expect(inferGender(145)).toBe('unknown')
    expect(inferGender(160)).toBe('unknown')
    expect(inferGender(175)).toBe('unknown')
  })

  it('rejecteaza valori invalide', () => {
    expect(inferGender(0)).toBe('unknown')
    expect(inferGender(-10)).toBe('unknown')
    expect(inferGender(Number.NaN)).toBe('unknown')
    expect(inferGender(Number.POSITIVE_INFINITY)).toBe('unknown')
  })
})

describe('vectorDistance', () => {
  it('returneaza 0 pentru vectori identici', () => {
    expect(vectorDistance([1, 2, 3], [1, 2, 3])).toBe(0)
  })

  it('returneaza Infinity daca un vector e gol', () => {
    expect(vectorDistance([], [1, 2, 3])).toBe(Infinity)
    expect(vectorDistance([1, 2, 3], [])).toBe(Infinity)
  })

  it('calculeaza distanta euclidiana normalizata', () => {
    const a = [0, 0]
    const b = [3, 4]
    // sqrt((9+16)/2) = sqrt(12.5) ≈ 3.5355
    expect(vectorDistance(a, b)).toBeCloseTo(Math.sqrt(12.5), 5)
  })

  it('lucreaza pe lungimea minima comuna', () => {
    expect(vectorDistance([1, 2, 3], [1, 2])).toBe(0)
  })
})
