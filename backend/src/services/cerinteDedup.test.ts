import { describe, it, expect } from 'vitest'
import { normalizeaza, similaritate, esteDuplicat } from './cerinteDedup.js'

describe('cerinteDedup — dubluri de cerințe reformulate (K16)', () => {
  it('normalizează diacritice + punctuație + majuscule (păstrează cuvintele)', () => {
    expect(normalizeaza('Mută avatarul în STÂNGA!')).toBe('muta avatarul in stanga')
  })

  it('aceleași cuvinte, altă ordine/punctuație/diacritice = duplicat', () => {
    expect(esteDuplicat('mută avatarul în stânga', 'Muta avatarul la stanga.')).toBe(true)
    expect(esteDuplicat('repară vocea live pe telefon', 'Pe telefon, repara vocea LIVE!')).toBe(true)
  })

  it('text identic (dar cu altă punctuație/majuscule) = similaritate 1', () => {
    expect(similaritate('Repară vocea live.', 'repara vocea live')).toBe(1)
  })

  it('cerințe DIFERITE care împart câteva cuvinte NU sunt unite', () => {
    expect(esteDuplicat('mută avatarul în stânga', 'mută harta în dreapta')).toBe(false)
    expect(esteDuplicat('repară vocea pe telefon', 'repară plata prin Revolut')).toBe(false)
  })

  it('similaritatea e 0–1 și crește cu suprapunerea', () => {
    const s = similaritate('adaugă buton de export pe pagina de trading', 'pune un buton de export în trading')
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThanOrEqual(1)
  })

  it('text gol nu crapă', () => {
    expect(normalizeaza('')).toBe('')
    expect(similaritate('', '')).toBe(1)
    expect(esteDuplicat('', 'ceva')).toBe(false)
  })
})
