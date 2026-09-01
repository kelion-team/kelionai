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
    // OK / AI are ambiguous (read as acronyms) — deliberately left untouched
    expect(academicPronounce('e OK, folosim AI', 'ro')).toBe('e OK, folosim AI')
  })

  it('handles acronyms with digits (MP3)', () => {
    expect(academicPronounce('salvează ca MP3', 'ro')).toBe('salvează ca em pe 3')
  })

  it('leaves text untouched for languages without a letter table', () => {
    expect(academicPronounce('ouvre le API', 'fr')).toBe('ouvre le API')
    expect(academicPronounce('il fait 27°C', 'fr')).toBe('il fait 27°C')
  })

  it('speaks Celsius in Romanian with correct number agreement', () => {
    expect(academicPronounce('Afară sunt 27°C', 'ro')).toBe('Afară sunt 27 de grade Celsius')
    expect(academicPronounce('e 1°C dimineața', 'ro')).toBe('e 1 grad Celsius dimineața')
    expect(academicPronounce('sunt 2°C', 'ro')).toBe('sunt 2 grade Celsius')
    expect(academicPronounce('sunt 19°C', 'ro')).toBe('sunt 19 grade Celsius')
    expect(academicPronounce('sunt 20°C', 'ro')).toBe('sunt 20 de grade Celsius')
    expect(academicPronounce('e 0°C', 'ro')).toBe('e 0 de grade Celsius')
  })

  it('speaks the spaced/ordinal degree glyphs too (Google transcribes „27° C”)', () => {
    expect(academicPronounce('azi sunt 27° C afară', 'ro')).toBe('azi sunt 27 de grade Celsius afară')
    expect(academicPronounce('sunt 27ºC', 'ro')).toBe('sunt 27 de grade Celsius')
  })

  it('speaks decimals, negatives and Fahrenheit', () => {
    expect(academicPronounce('sunt 23.5°C', 'ro')).toBe('sunt 23.5 de grade Celsius')
    expect(academicPronounce('afara sunt -5°C', 'ro')).toBe('afara sunt minus 5 grade Celsius')
    expect(academicPronounce('sunt -21°C', 'ro')).toBe('sunt minus 21 de grade Celsius')
    expect(academicPronounce('sunt 100°F afară', 'ro')).toBe('sunt 100 de grade Fahrenheit afară')
  })

  it('speaks temperatures in English', () => {
    expect(academicPronounce('it is 27°C outside', 'en')).toBe('it is 27 degrees Celsius outside')
    expect(academicPronounce('1°C exactly', 'en')).toBe('1 degree Celsius exactly')
    expect(academicPronounce('about 32°F', 'en')).toBe('about 32 degrees Fahrenheit')
  })

  it('does not touch degree-less text or lone degree signs', () => {
    expect(academicPronounce('un unghi de 27°', 'ro')).toBe('un unghi de 27°')
    expect(academicPronounce('temperatura a crescut', 'ro')).toBe('temperatura a crescut')
  })

  it('keeps temperature ranges intact (the dash is not a minus)', () => {
    expect(academicPronounce('diseară vor fi 20-27°C', 'ro')).toBe('diseară vor fi 20-27 de grade Celsius')
  })
})
