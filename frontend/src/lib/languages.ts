// Languages Kelion can hear (Web Speech recognition) and speak (Chirp 3 HD).
// BCP-47 tags. The label is the language's own endonym so it's recognisable.
// NB: language DETECTION happens on the server now (services/lang.ts there);
// the client only picks a sensible starting language from the browser locale.

export interface SpeechLang {
  readonly code: string
  readonly label: string
}

// DOAR cele 7 limbi ale aplicației (regula finală, Adrian: „gardat pe cele 7,
// niciodată rusă"). Lista veche de 27 permitea alegerea rusei din Setări, care
// devenea limbă persistată cu lock absolut — ocolind toată garda serverului.
// Serverul respinge acum orice cod din afara celor 7 (routes/prefs.ts).
export const LANGS: readonly SpeechLang[] = [
  { code: 'en-US', label: 'English' },
  { code: 'ro-RO', label: 'Română' },
  { code: 'fr-FR', label: 'Français' },
  { code: 'de-DE', label: 'Deutsch' },
  { code: 'es-ES', label: 'Español' },
  { code: 'it-IT', label: 'Italiano' },
  { code: 'pt-BR', label: 'Português' },
]

// Limba de pornire a recognizer-ului (regula finală, Adrian 24 iul: „default
// ENGLEZĂ; după identificarea limbii se aplică procedura existentă"). FĂRĂ
// ghicit din limba browserului: pornim de la limba IDENTIFICATĂ (uiLang vine
// din oglinda serverului), altfel engleză. Comutarea ulterioară o face frame-ul
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
