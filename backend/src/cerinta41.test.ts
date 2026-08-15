import { describe, it, expect } from 'vitest'
import { LANG_OPTIONS } from '../../frontend/src/lib/langList'
import { LANGS } from '../../frontend/src/lib/languages'

describe('Language options in admin bar and UI', () => {
  it('includes core languages with proper labels', () => {
    const codes = LANG_OPTIONS.map((o) => o.code)
    expect(codes).toContain('ro')
    expect(codes).toContain('en')
    expect(codes).toContain('fr')
    expect(codes).toContain('de')
    expect(codes).toContain('es')
  })

  it('provides speech languages matching interface options', () => {
    const speechCodes = LANGS.map((l) => l.code.split('-')[0])
    expect(speechCodes).toContain('ro')
    expect(speechCodes).toContain('en')
  })
})
