import { describe, it, expect } from 'vitest'
import { academicPronounce } from './services/pronounce.js'

describe('academicPronounce', () => {
  it('respells known tech acronyms letter-by-letter in Romanian', () => {
    expect(academicPronounce('Deschide un API acum', 'ro')).toBe('Deschide un a pe i acum')
    expect(academicPronounce('conectează pe SSH', 'ro')).toBe('conectează pe es es haș')
  })

  it('respells in English with English letter names', () => {
    expect(academicPronounce('open the URL', 'en')).toBe('open the you ar el')
  })

  it('leaves ordinary words and non-listed caps untouched', () => {
    expect(academicPronounce('ADRIAN a spus STOP', 'ro')).toBe('ADRIAN a spus STOP')
    // OK / AI sunt ambigue (citite ca acronime) — lăsate anume neatinse
    expect(academicPronounce('e OK, folosim AI', 'ro')).toBe('e OK, folosim AI')
  })

  it('handles acronyms with digits (MP3)', () => {
    expect(academicPronounce('salvează ca MP3', 'ro')).toBe('salvează ca em pe 3')
  })

  it('leaves text untouched for languages without a letter table', () => {
    expect(academicPronounce('ouvre le API', 'fr')).toBe('ouvre le API')
  })
})
