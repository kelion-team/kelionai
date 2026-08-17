import { describe, it, expect } from 'vitest'
import {
  clasificaEsecFree,
  decideEscaladareConstructor,
} from './escaladareConstructor.js'

describe('decideEscaladareConstructor — free first, paid doar rezervă', () => {
  it('nu escaladează dacă paid lipsește (cheie/model)', () => {
    const d = decideEscaladareConstructor({
      peFree: true,
      paidDisponibil: false,
      motivFree: 'no_change',
    })
    expect(d.escaladeaza).toBe(false)
    expect(d.sursaUrmatoare).toBe('free')
    expect(d.brainRaport).toBe('free_local')
  })

  it('escaladează pe no_change când paid e disponibil', () => {
    const d = decideEscaladareConstructor({
      peFree: true,
      paidDisponibil: true,
      motivFree: 'no_change',
    })
    expect(d.escaladeaza).toBe(true)
    expect(d.sursaUrmatoare).toBe('platit')
    expect(d.motiv).toBe('no_change')
    expect(d.brainRaport).toBe('paid_cloud')
  })

  it('escaladează pe free_indisponibil / timeout', () => {
    expect(
      decideEscaladareConstructor({
        peFree: true,
        paidDisponibil: true,
        motivFree: 'free_indisponibil',
      }).escaladeaza,
    ).toBe(true)
    expect(
      decideEscaladareConstructor({
        peFree: true,
        paidDisponibil: true,
        motivFree: 'timeout_throttle',
      }).escaladeaza,
    ).toBe(true)
  })

  it('nu escaladează pe motiv gol / vag', () => {
    const d = decideEscaladareConstructor({
      peFree: true,
      paidDisponibil: true,
      motivFree: '',
    })
    expect(d.escaladeaza).toBe(false)
    expect(d.motiv).toBe('motiv_insuficient')
  })

  it('dacă e deja pe paid, nu „re-escaladează”', () => {
    const d = decideEscaladareConstructor({
      peFree: false,
      paidDisponibil: true,
      motivFree: 'no_change',
    })
    expect(d.escaladeaza).toBe(false)
    expect(d.brainRaport).toBe('paid_cloud')
  })

  it('clasificaEsecFree recunoaște texte reale din agent', () => {
    expect(clasificaEsecFree('aider n-a modificat nimic [no_edit]')).toBe('no_change')
    expect(clasificaEsecFree('creier local Ollama indisponibil')).toBe('free_indisponibil')
    expect(clasificaEsecFree('aider sugrumat: 429 rate limit')).toBe('timeout_throttle')
  })
})
