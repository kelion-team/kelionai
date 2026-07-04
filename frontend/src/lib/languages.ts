// Languages Kelion can hear (Web Speech recognition) and speak (Chirp 3 HD).
// BCP-47 tags. The label is the language's own endonym so it's recognisable.
// NB: language DETECTION happens on the server now (services/lang.ts there);
// the client only picks a sensible starting language from the browser locale.

export interface SpeechLang {
  readonly code: string
  readonly label: string
}

export const LANGS: readonly SpeechLang[] = [
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

// Pick the best starting language: an exact tag match for the browser locale,
// else a base-language match, else English.
export function defaultSpeechLang(uiLang: string): string {
  const nav = typeof navigator !== 'undefined' ? navigator.language : uiLang
  const candidates = [nav, uiLang]
  for (const c of candidates) {
    const lc = c.toLowerCase()
    const exact = LANGS.find((l) => l.code.toLowerCase() === lc)
    if (exact) return exact.code
    const base = lc.split('-')[0]
    const byBase = LANGS.find((l) => l.code.toLowerCase().startsWith(base + '-'))
    if (byBase) return byBase.code
  }
  return 'en-US'
}
