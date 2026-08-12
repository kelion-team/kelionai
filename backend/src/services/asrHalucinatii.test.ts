import { describe, it, expect } from 'vitest'
import { esteHalucinatieASR } from './asrHalucinatii.js'

describe('asrHalucinatii — fantomele STT pe tăcere (K8)', () => {
  it('prinde halucinațiile cunoscute (întreg transcriptul)', () => {
    expect(esteHalucinatieASR('Greț.')).toBe(true)
    expect(esteHalucinatieASR('greață')).toBe(true)
    expect(esteHalucinatieASR('Subtitrare')).toBe(true)
    expect(esteHalucinatieASR('Thanks for watching!')).toBe(true)
    expect(esteHalucinatieASR('Mulțumesc pentru vizionare')).toBe(true)
  })

  it('prinde transcriptul doar cu simboluri/punctuație', () => {
    expect(esteHalucinatieASR('...')).toBe(true)
    expect(esteHalucinatieASR('♪')).toBe(true)
    expect(esteHalucinatieASR('[music]')).toBe(true)
  })

  it('NU taie cuvinte reale scurte (0 pierdere de mesaj adevărat)', () => {
    expect(esteHalucinatieASR('Da')).toBe(false)
    expect(esteHalucinatieASR('Nu')).toBe(false)
    expect(esteHalucinatieASR('OK')).toBe(false)
    expect(esteHalucinatieASR('Bine')).toBe(false)
  })

  it('NU taie o frază reală care conține un cuvânt din listă', () => {
    // „mulțumesc" apare, dar mesajul e real și mai lung → se păstrează.
    expect(esteHalucinatieASR('Mulțumesc, poți deschide harta?')).toBe(false)
    expect(esteHalucinatieASR('adaugă subtitrare la videoclipul meu')).toBe(false)
  })

  it('gol → nu e halucinație (nu inventăm nimic pe gol)', () => {
    expect(esteHalucinatieASR('')).toBe(false)
    expect(esteHalucinatieASR('   ')).toBe(false)
  })
})
