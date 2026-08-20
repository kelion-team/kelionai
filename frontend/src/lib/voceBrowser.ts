// ── GURA DE SIGURANȚĂ: vocea browserului (Web Speech API) ────────────────────
// Owner, 20 aug: „chatul audio inexistent". Măsurat în cod: pe turele SCRISE (și
// offline) gura reală poate rămâne MUTĂ — sesiunea live implicită (Gemini Live)
// NU rostește textul scris (`rvLiveRef` e null, deci `feedSpeech` nu are ce cânta),
// iar vocea Chirp de pe server vine doar dacă serverul chiar o trimite. Când NIMIC
// nu a sunat, răspunsul rămânea tăcut. Aici e plasa: dacă, după ce răspunsul e gata,
// n-a rostit nimeni nimic, îl rostește vocea NATIVĂ a browserului — mereu prezentă,
// fără rețea, fără cost. Nu înlocuiește Chirp/Live; e doar ultima redută, ca omul să
// AUDĂ răspunsul de fiecare dată. Strat pur, best-effort — nu aruncă niciodată.

import type { Lang } from './i18n'

// Limba noastră → eticheta BCP-47 pe care o cere motorul de voce al browserului.
// Fapt static despre limbaj (nu o valoare afișată/tarifată → nu e hardcod interzis).
const ETICHETA_VOCE: Record<Lang, string> = {
  en: 'en-US',
  ro: 'ro-RO',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  pt: 'pt-PT',
}

function sinteza(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null
  const s = (window as unknown as { speechSynthesis?: SpeechSynthesis }).speechSynthesis
  return s ?? null
}

/** Alege o voce care se potrivește limbii (ex. `ro`), altfel una cu prefixul corect,
 *  altfel `null` (motorul folosește vocea implicită). PURĂ pe lista dată — testabilă. */
export function alegeVoce(voci: SpeechSynthesisVoice[], lang: Lang): SpeechSynthesisVoice | null {
  const eticheta = ETICHETA_VOCE[lang]
  const prefix = lang + '-'
  return (
    voci.find((v) => v.lang === eticheta) ||
    voci.find((v) => v.lang?.toLowerCase().startsWith(prefix)) ||
    voci.find((v) => v.lang?.toLowerCase().startsWith(lang)) ||
    null
  )
}

/** Rostește textul cu vocea browserului, în limba userului. Oprește orice rostire
 *  anterioară (o singură gură). Best-effort: dacă API-ul lipsește, nu face nimic. */
export function vorbesteLocal(text: string, lang: Lang): void {
  const s = sinteza()
  if (!s || !text.trim()) return
  try {
    s.cancel() // o singură voce — taie ce era în coadă
    const u = new SpeechSynthesisUtterance(text)
    u.lang = ETICHETA_VOCE[lang] || 'en-US'
    const voce = alegeVoce(s.getVoices(), lang)
    if (voce) u.voice = voce
    s.speak(u)
  } catch {
    /* motor de voce indisponibil — tăcere, nu eroare */
  }
}

/** Taie vocea browserului (barge-in / tură nouă / stop). Best-effort. */
export function opresteVoceLocal(): void {
  try {
    sinteza()?.cancel()
  } catch {
    /* nimic de oprit */
  }
}
