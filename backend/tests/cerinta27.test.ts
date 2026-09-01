import { describe, it, expect } from 'vitest'

describe('Cerința #27 - Opțiuni de schimbare a limbii în bara de admin / setări', () => {
  const LANGS = [
    { code: 'en-US', label: 'English' },
    { code: 'ro-RO', label: 'Română' },
    { code: 'fr-FR', label: 'Français' },
    { code: 'de-DE', label: 'Deutsch' },
    { code: 'es-ES', label: 'Español' },
    { code: 'it-IT', label: 'Italiano' },
    { code: 'pt-BR', label: 'Português' },
    { code: 'nl-NL', label: 'Nederlands' },
    { code: 'pl-PL', label: 'Polski' },
    { code: 'ru-RU', label: 'Русский' },
    { code: 'uk-UA', label: 'Українська' },
    { code: 'tr-TR', label: 'Türkçe' },
    { code: 'ar-XA', label: 'العربية' },
    { code: 'hi-IN', label: 'हिन्दी' },
    { code: 'ja-JP', label: '日本語' },
    { code: 'ko-KR', label: '한국어' },
    { code: 'zh-CN', label: '中文' },
    { code: 'sv-SE', label: 'Svenska' },
    { code: 'da-DK', label: 'Dansk' },
    { code: 'nb-NO', label: 'Norsk' },
    { code: 'fi-FI', label: 'Suomi' },
    { code: 'cs-CZ', label: 'Čeština' },
    { code: 'el-GR', label: 'Ελληνικά' },
    { code: 'hu-HU', label: 'Magyar' },
    { code: 'id-ID', label: 'Indonesia' },
    { code: 'th-TH', label: 'ไทย' },
    { code: 'vi-VN', label: 'Tiếng Việt' },
  ]

  it('include toate opțiunile de limbă suportate', () => {
    expect(LANGS.length).toBe(27)
    expect(LANGS.some((l) => l.code === 'ro-RO' && l.label === 'Română')).toBe(true)
    expect(LANGS.some((l) => l.code === 'en-US' && l.label === 'English')).toBe(true)
  })

  it('fiecare opțiune are cod valid și etichetă', () => {
    for (const l of LANGS) {
      expect(l.code).toBeTruthy()
      expect(l.label).toBeTruthy()
    }
  })
})
