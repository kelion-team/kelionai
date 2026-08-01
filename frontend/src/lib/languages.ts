// Languages Kelion can hear (Web Speech recognition) and speak (Chirp 3 HD).
// BCP-47 tags. The label is the language's own endonym so it's recognisable.
// NB: language DETECTION happens on the server now (services/lang.ts there);
// the client only picks a sensible starting language from the browser locale.

export interface SpeechLang {
  readonly code: string
  readonly label: string
}

// ALL languages stay (Adrian's order, Jul 25: "leave me all the languages,
// don't remove anything"). The cut to 7 done earlier the same day was WRONG
// — it shrank the product instead of fixing the real problem (automatic
// language drift, which is guarded separately in services/lang.ts on the server).
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

// The recognizer's starting language (the final rule, Adrian Jul 24:
// "default ENGLISH; after language identification the existing procedure
// applies"). NO guessing from the browser language: we start from the
// IDENTIFIED language (uiLang comes from the server mirror), otherwise
// English. The later switching is done by the frame
// {lang} de la server (applyLang), nu noi aici.
export function defaultSpeechLang(uiLang: string): string {
  const lc = (uiLang || 'en').toLowerCase()
  const exact = LANGS.find((l) => l.code.toLowerCase() === lc)
  if (exact) return exact.code
  const base = lc.split('-')[0]
  const byBase = LANGS.find((l) => l.code.toLowerCase().startsWith(base + '-'))
  if (byBase) return byBase.code
  return 'en-US'
}
