import { describe, it, expect } from 'vitest'
import { alfabetStrain } from './services/urecheLiveGemini.js'

// GARDUL DE ALFABET (4 aug): urechea scria românește în greacă/chirilic/arabă.
describe('alfabetStrain — aruncă transcrierile în alt alfabet decât limba', () => {
  it('chirilic pe română = străin', () => {
    expect(alfabetStrain('Чекався.', 'ro-RO')).toBe(true)
  })
  it('greacă pe română = străin', () => {
    expect(alfabetStrain('Και όλοι.', 'ro')).toBe(true)
  })
  it('română cu diacritice = OK (latin)', () => {
    expect(alfabetStrain('Salut, mă auzi și acum?', 'ro')).toBe(false)
  })
  it('engleză pe en = OK', () => {
    expect(alfabetStrain('Hello, can you hear me?', 'en-US')).toBe(false)
  })
  it('dacă limba chiar e chirilică (ru), NU filtrăm chirilicul', () => {
    expect(alfabetStrain('Привет', 'ru')).toBe(false)
  })
  it('fără limbă → nu filtrăm (nu știm alfabetul așteptat)', () => {
    expect(alfabetStrain('Чекався', '')).toBe(false)
  })
  it('prea scurt → nu decidem', () => {
    expect(alfabetStrain('Я', 'ro')).toBe(false)
  })
})
