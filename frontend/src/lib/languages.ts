// Languages Kelion can hear (Web Speech recognition) and speak (Chirp 3 HD).
// BCP-47 tags. The label is the language's own endonym so it's recognisable.

import { franc } from 'franc-min'

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

// ISO 639-3 (what franc returns) → our BCP-47 codes.
const ISO3_TO_BCP47: Record<string, string> = {
  eng: 'en-US', ron: 'ro-RO', fra: 'fr-FR', deu: 'de-DE', spa: 'es-ES',
  ita: 'it-IT', por: 'pt-BR', nld: 'nl-NL', pol: 'pl-PL', rus: 'ru-RU',
  ukr: 'uk-UA', tur: 'tr-TR', arb: 'ar-XA', ara: 'ar-XA', hin: 'hi-IN',
  jpn: 'ja-JP', kor: 'ko-KR', cmn: 'zh-CN', zho: 'zh-CN', swe: 'sv-SE',
  dan: 'da-DK', nob: 'nb-NO', nor: 'nb-NO', fin: 'fi-FI', ces: 'cs-CZ',
  ell: 'el-GR', hun: 'hu-HU', ind: 'id-ID', tha: 'th-TH', vie: 'vi-VN',
}

// Detect the language of a piece of text → a supported BCP-47 code, or null
// when the text is too short / uncertain to decide. Used to pick the voice +
// recognizer language automatically (Claude already replies in-language).
export function detectLangFromText(text: string): string | null {
  const clean = text.trim()
  if (clean.length < 8) return null // too short to be reliable
  const iso3 = franc(clean, { minLength: 8 })
  if (iso3 === 'und') return null
  return ISO3_TO_BCP47[iso3] ?? null
}

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
