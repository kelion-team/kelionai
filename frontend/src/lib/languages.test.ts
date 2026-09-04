import { describe, expect, it } from 'vitest'

import { LANGS, defaultSpeechLang } from './languages'

describe('defaultSpeechLang', () => {
  it('maps supported locale tags to the correct speech voice', () => {
    expect(defaultSpeechLang('ro')).toBe('ro-RO')
    expect(defaultSpeechLang('ro-RO')).toBe('ro-RO')
    expect(defaultSpeechLang('fr-FR')).toBe('fr-FR')
    expect(defaultSpeechLang('xx-YY')).toBe('en-US')
  })

  it('keeps the full supported language set available to the UI', () => {
    expect(LANGS.some((lang) => lang.code === 'en-US')).toBe(true)
    expect(LANGS.some((lang) => lang.code === 'ro-RO')).toBe(true)
    expect(LANGS.some((lang) => lang.code === 'fr-FR')).toBe(true)
    expect(LANGS.some((lang) => lang.code === 'de-DE')).toBe(true)
  })
})
