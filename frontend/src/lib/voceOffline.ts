import type { Lang } from './i18n'

// ── GURA OFFLINE (Faza 1 · M3): Kelion VORBEȘTE fără net ─────────────────────
// Owner (PROIECT-OFFLINE-FIRST §3): „Jarvis complet care vorbește, aude, vede" —
// 100% offline. Aici e GURA offline: TTS local prin Web Speech `speechSynthesis`,
// construit în browser/OS — offline, GRATIS, ZERO descărcare („dacă e free, nici
// pe noi să nu ne coste"). E `voceBrowser` (scos la teardown-ul de voce) reconstruit
// CURAT, folosit DOAR pe calea offline (online rămâne neatins).
//
// Cinstit (regula #1 + LEGEA FAPTEI): dacă dispozitivul nu are TTS în browser, TACE —
// nu pretinde că vorbește. Alege o voce pentru limba userului dacă există; altfel
// lasă vocea implicită a sistemului cu eticheta de limbă corectă.

// Codul BCP-47 per limba UI (fapt static despre limbaj, nu valoare afișată/tarifată).
const COD_LIMBA: Record<Lang, string> = {
  en: 'en-US',
  ro: 'ro-RO',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  pt: 'pt-PT',
}

/** Poate dispozitivul să vorbească offline? (Web Speech TTS prezent.) Măsurat. */
export function poateVorbiOffline(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  )
}

// Vocile pot veni ASINCRON (getVoices() e gol până la evenimentul 'voiceschanged').
// Le ținem minte când sosesc, ca alegerea vocii să nu fie mereu goală la prima frază.
let vociCache: SpeechSynthesisVoice[] = []
function reimprospateazaVoci(): void {
  if (!poateVorbiOffline()) return
  try {
    const v = window.speechSynthesis.getVoices()
    if (v && v.length) vociCache = v
  } catch {
    /* indisponibil — rămânem pe vocea implicită a sistemului */
  }
}
if (poateVorbiOffline()) {
  reimprospateazaVoci()
  try {
    window.speechSynthesis.addEventListener('voiceschanged', reimprospateazaVoci)
  } catch {
    /* unele browsere nu emit evenimentul — getVoices() se reîncearcă la fiecare frază */
  }
}

function alegeVoce(cod: string): SpeechSynthesisVoice | null {
  if (!vociCache.length) reimprospateazaVoci()
  const scurt = cod.slice(0, 2).toLowerCase()
  // Întâi potrivire exactă pe limbă+regiune, apoi doar pe limbă (ro-RO → ro).
  return (
    vociCache.find((v) => v.lang?.toLowerCase() === cod.toLowerCase()) ??
    vociCache.find((v) => v.lang?.toLowerCase().startsWith(scurt)) ??
    null
  )
}

/** Spune `text` cu vocea locală, în limba userului. O singură voce odată (taie ce
 *  spunea). No-op cinstit dacă browserul n-are TTS sau textul e gol. */
export function vorbesteOffline(text: string, lang: Lang): void {
  if (!poateVorbiOffline()) return
  const curat = text.trim()
  if (!curat) return
  const synth = window.speechSynthesis
  try {
    synth.cancel() // anti-suprapunere: o singură gură
    const u = new SpeechSynthesisUtterance(curat)
    const cod = COD_LIMBA[lang] ?? 'en-US'
    u.lang = cod
    const voce = alegeVoce(cod)
    if (voce) u.voice = voce
    synth.speak(u)
  } catch {
    /* sinteza a picat — tăcere onestă, nu aruncăm peste calea de chat */
  }
}

/** Oprește imediat vocea offline (barge-in / stop / tură nouă). */
export function opresteVoceaOffline(): void {
  if (!poateVorbiOffline()) return
  try {
    window.speechSynthesis.cancel()
  } catch {
    /* nimic */
  }
}
