import { afterEach, describe, it, expect, vi } from 'vitest'
import { alegeVoce, opresteVoceLocal, vorbesteLocal } from './lib/voceBrowser'

const v = (lang: string, localService = true): SpeechSynthesisVoice =>
  ({ lang, localService }) as unknown as SpeechSynthesisVoice

afterEach(() => {
  opresteVoceLocal()
  vi.unstubAllGlobals()
})

describe('alegeVoce — potrivirea vocii browserului cu limba userului', () => {
  it('alege potrivirea exactă BCP-47 când există (ro → ro-RO)', () => {
    const voci = [v('en-US'), v('ro-RO'), v('fr-FR')]
    expect(alegeVoce(voci, 'ro')?.lang).toBe('ro-RO')
  })

  it('cade pe prefixul limbii dacă nu e potrivirea exactă (ro → ro-MD)', () => {
    const voci = [v('en-US'), v('ro-MD')]
    expect(alegeVoce(voci, 'ro')?.lang).toBe('ro-MD')
  })

  it('întoarce null când limba lipsește cu totul (fără invenție)', () => {
    const voci = [v('en-US'), v('de-DE')]
    expect(alegeVoce(voci, 'ro')).toBeNull()
  })

  it('nu confundă limbi diferite cu același început de cuvânt (pt ≠ en)', () => {
    const voci = [v('en-GB')]
    expect(alegeVoce(voci, 'pt')).toBeNull()
  })

  it('refuză o voce remote chiar dacă limba se potrivește', () => {
    expect(alegeVoce([v('ro-RO', false)], 'ro')).toBeNull()
  })
})

describe('vocea browserului — lifecycle sigur pentru ureche și barge-in', () => {
  it('anunță startul și exact un final chiar dacă browserul emite end la cancel', () => {
    let activa: SpeechSynthesisUtterance | null = null
    const synth = {
      getVoices: () => [v('ro-RO')],
      speak: (u: SpeechSynthesisUtterance) => { activa = u },
      cancel: () => activa?.onend?.(new Event('end') as SpeechSynthesisEvent),
    } as unknown as SpeechSynthesis
    class Utterance {
      lang = ''
      voice: SpeechSynthesisVoice | null = null
      onstart: ((event: SpeechSynthesisEvent) => unknown) | null = null
      onend: ((event: SpeechSynthesisEvent) => unknown) | null = null
      onerror: ((event: SpeechSynthesisErrorEvent) => unknown) | null = null
      constructor(public text: string) {}
    }
    vi.stubGlobal('window', { speechSynthesis: synth })
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
    const onStart = vi.fn()
    const onEnd = vi.fn()

    expect(vorbesteLocal('salut', 'ro', { onStart, onEnd })).toBe(true)
    activa?.onstart?.(new Event('start') as SpeechSynthesisEvent)
    expect(onStart).toHaveBeenCalledOnce()

    opresteVoceLocal()
    expect(onEnd).toHaveBeenCalledOnce()
  })

  it('refuză curat textul gol sau un motor indisponibil', () => {
    vi.stubGlobal('window', {})
    expect(vorbesteLocal('salut', 'ro')).toBe(false)
    expect(vorbesteLocal('   ', 'ro')).toBe(false)
  })

  it('nu apelează speak dacă există numai o voce remote', () => {
    const speak = vi.fn()
    vi.stubGlobal('window', {
      speechSynthesis: { getVoices: () => [v('ro-RO', false)], speak, cancel: vi.fn() },
    })
    vi.stubGlobal('SpeechSynthesisUtterance', class { lang = ''; voice = null; constructor(public text: string) {} })
    expect(vorbesteLocal('salut', 'ro')).toBe(false)
    expect(speak).not.toHaveBeenCalled()
  })
})
