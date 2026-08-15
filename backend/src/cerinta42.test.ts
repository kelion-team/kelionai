import { describe, it, expect } from 'vitest'
import { LANG_OPTIONS } from '../../frontend/src/lib/langList'
import { LANGS } from '../../frontend/src/lib/languages'

describe('Cerința #42 - Language options in admin bar and UI', () => {
  it('includes complete set of supported languages in the admin selector list', () => {
    const codes = LANG_OPTIONS.map((o) => o.code)
    expect(codes).toContain('ro')
    expect(codes).toContain('en')
    expect(codes).toContain('fr')
    expect(codes).toContain('de')
    expect(codes).toContain('es')
    expect(codes).toContain('it')
    expect(codes).toContain('pt')
    expect(codes).toContain('ru')
    expect(codes).toContain('uk')
    expect(codes).toContain('zh')
    expect(codes).toContain('ja')
  })

  it('speech language options are defined and map properly to interface selectors', () => {
    const speechCodes = LANGS.map((l) => l.code.split('-')[0])
    expect(speechCodes).toContain('ro')
    expect(speechCodes).toContain('en')
    expect(speechCodes).toContain('fr')
    expect(speechCodes).toContain('de')
    expect(speechCodes).toContain('es')
  })
})
