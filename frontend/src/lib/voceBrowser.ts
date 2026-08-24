// Fallback vocal local. Folosește exclusiv voci marcate `localService` de browser;
// o voce remote sau implicită nu este disponibilitate demonstrată în avion.

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

export interface LocalSpeechHooks {
  onStart?: () => void
  onEnd?: () => void
}

// `speechSynthesis.cancel()` nu garantează un eveniment `end` în toate
// browserele. Păstrăm finalizatorul separat ca urechea să fie dezmuțită sigur
// inclusiv la barge-in, eroare sau o rostire înlocuită de alta.
let terminaRostireaActiva: (() => void) | null = null

/** Alege o voce care se potrivește limbii (ex. `ro`), altfel una cu prefixul corect,
 *  altfel `null` (motorul folosește vocea implicită). PURĂ pe lista dată — testabilă. */
export function alegeVoce(voci: SpeechSynthesisVoice[], lang: Lang): SpeechSynthesisVoice | null {
  const eticheta = ETICHETA_VOCE[lang]
  const prefix = lang + '-'
  const locale = voci.filter((voice) => voice.localService === true)
  return (
    locale.find((v) => v.lang === eticheta) ||
    locale.find((v) => v.lang?.toLowerCase().startsWith(prefix)) ||
    locale.find((v) => v.lang?.toLowerCase().startsWith(lang)) ||
    null
  )
}

export function voceLocalaVorbeste(): boolean {
  return terminaRostireaActiva !== null
}

/** Disponibilitate reală pentru limba curentă, fără a selecta o voce remote. */
export function voceLocalaDisponibila(lang: Lang): boolean {
  const speech = sinteza()
  return speech ? alegeVoce(speech.getVoices(), lang) !== null : false
}

/** Rostește textul cu vocea browserului, în limba userului. Oprește orice rostire
 *  anterioară (o singură gură). Best-effort: dacă API-ul lipsește, nu face nimic. */
export function vorbesteLocal(text: string, lang: Lang, hooks: LocalSpeechHooks = {}): boolean {
  const s = sinteza()
  if (!s || !text.trim()) return false
  try {
    opresteVoceLocal() // o singură voce — taie ce era în coadă
    const u = new SpeechSynthesisUtterance(text)
    u.lang = ETICHETA_VOCE[lang] || 'en-US'
    const voce = alegeVoce(s.getVoices(), lang)
    if (!voce) return false
    u.voice = voce
    let terminata = false
    const termina = (): void => {
      if (terminata) return
      terminata = true
      if (terminaRostireaActiva === termina) terminaRostireaActiva = null
      hooks.onEnd?.()
    }
    terminaRostireaActiva = termina
    u.onstart = () => hooks.onStart?.()
    u.onend = termina
    u.onerror = termina
    s.speak(u)
    return true
  } catch {
    terminaRostireaActiva?.()
    /* motor de voce indisponibil — tăcere, nu eroare */
    return false
  }
}

/** Taie vocea browserului (barge-in / tură nouă / stop). Best-effort. */
export function opresteVoceLocal(): void {
  const termina = terminaRostireaActiva
  terminaRostireaActiva = null
  try {
    sinteza()?.cancel()
  } catch {
    /* nimic de oprit */
  } finally {
    termina?.()
  }
}
