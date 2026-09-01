import { describe, expect, it } from 'vitest'

import { detectLang, detectSpeechLang, primaryLang, trackSpeechLang } from './lang'

describe('language guardrails', () => {
  it('normalizes locale tags and detects clear language signals', () => {
    expect(primaryLang('ro-RO')).toBe('ro')
    expect(detectLang('Bună ziua, mulțumesc')).toBe('ro')
    expect(detectLang('Gracias por tu ayuda', 'en')).toBe('es')
    expect(detectLang('Hello there, thanks', 'ro')).toBe('en')
  })

  it('keeps speech-language tracking in the supported set and rejects unsupported drift', () => {
    expect(detectSpeechLang('Salut, pot continua?', 'en')).toBe('ro-RO')
    expect(detectSpeechLang('Привет мир', 'en')).toBe('ru-RU')
    expect(trackSpeechLang('user@example.com', 'Привет мир', 'en')).toBeNull()
    expect(trackSpeechLang('user@example.com', 'hola', 'en')).toBeNull()
  })
})
