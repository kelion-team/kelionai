import { describe, it, expect } from 'vitest'
import { alegeVoce } from './lib/voceBrowser'

// Voci fictive, doar cu `lang` (restul câmpurilor nu contează pentru alegere).
const v = (lang: string): SpeechSynthesisVoice => ({ lang }) as unknown as SpeechSynthesisVoice

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
})
