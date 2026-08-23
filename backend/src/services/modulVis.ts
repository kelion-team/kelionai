// ── #1 MODUL VIS (owner, 22 aug 2026: „uimește-mă") ──────────────────────────
//
// Când tu dormi, Kelion nu se oprește — visează. Consolidă memoria zilei:
//   1. Comprimă episoadele vechi (importanță în scădere → le reduce)
//   2. Extrage patternuri („stresat 3 zile la rând la ora 14")
//   3. Pregătește context pentru dimineață (salut personalizat)
//
// La trezire (prima interacțiune după 6+ ore de inactivitate), Kelion spune:
//   „Bună dimineața. Am observat că ai avut 3 întâlniri stresante ieri —
//    azi ai doar una la 11. Te ajut cu ceva?"
//
// Nu e un log — e o narațiune, generată din memoria senzorială + conversații.

import { getMemories, addMemory, searchMemories } from '../db.js'
import { stariEmotionaleRecente, emotieDominanta } from './memorieEmotionala.js'
import { observatiiRecente } from './vedereContinua.js'
import { evenimenteSonoreRecente } from './auzAmbiental.js'

const PRAG_INACTIVITATE_MS = 6 * 60 * 60 * 1000 // 6 ore = somn
const ORA_VIS_NOAPTE = 3 // la 3 noaptea — sigur dormi

let ultimaActivitate = Date.now()
let visRulatAstazi = false
let salutPregatit: string | null = null

/** Marchează activitate (apelat la fiecare interacțiune a userului). */
export function marcheazaActivitate(): void {
  ultimaActivitate = Date.now()
  // Dacă a fost o pauză lungă (somn), resetează visul pentru ziua nouă
  if (salutPregatit) {
    // Salutul a fost pregătit — userul s-a trezit, îl vom livra la prima ocazie
  }
}

/** Detectează dacă userul a dormit (inactivitate > 6 ore). */
export function aDormit(): boolean {
  return Date.now() - ultimaActivitate > PRAG_INACTIVITATE_MS
}

/** Consolidarea memoriei — comprimă episoadele vechi, extrage patternuri.
 *  Apelat automat la 3 noaptea (cron din index.ts). */
export async function ruleazaVisul(email: string): Promise<void> {
  if (visRulatAstazi) return
  const acum = new Date()
  // Rulează doar noaptea (între 0 și 5 dimineața)
  if (acum.getHours() < 0 || acum.getHours() > 5) return

  visRulatAstazi = true
  // Reset la miezul nopții următor
  setTimeout(() => { visRulatAstazi = false }, 24 * 60 * 60_000)

  try {
    // 1. Extrage patternuri din memoria zilei
    const memorii = await getMemories(email, 60)
    // Memory interface are doar content — filtrăm pe baza prefixelor
    const episoade = memorii.filter((m) => m.content.startsWith('[VIS]') || m.content.includes('episod'))
    const emotionale = memorii.filter((m) => m.content.startsWith('[EMOȚIONAL]'))
    const vizuale = memorii.filter((m) => m.content.startsWith('[VIZUAL]'))
    const sonore = memorii.filter((m) => m.content.startsWith('[AUDITIV]'))

    const patternuri: string[] = []

    // Pattern emoțional: ce domină ziua?
    const dominanta = emotieDominanta(720) // ultimele 12 ore
    if (dominanta && dominanta !== 'calm' && dominanta !== 'neutru') {
      patternuri.push(`emoția dominantă a zilei: ${dominanta}`)
    }

    // Pattern temporal: câte evenimente sonore urgente?
    const sonoreUrgente = evenimenteSonoreRecente().filter((e) => e.ts > Date.now() - 24 * 60 * 60_000)
    if (sonoreUrgente.length > 3) {
      patternuri.push(`${sonoreUrgente.length} evenimente sonore în ziua trecută`)
    }

    // Pattern vizual: activitate intensă?
    const obsVizuale = observatiiRecente().filter((o) => o.ts > Date.now() - 24 * 60 * 60_000)
    if (obsVizuale.length > 10) {
      patternuri.push(`multă activitate vizuală (${obsVizuale.length} observații)`)
    }

    // 2. Salvează visul ca memorie episodică (pentru recall viitor)
    if (patternuri.length > 0) {
      const continutVis = `[VIS] Consolidare noapte ${acum.toISOString().slice(0, 10)}: ${patternuri.join('; ')}`
      await addMemory(email, continutVis, 'kelion', {
        tip: 'episodic',
        importanta: 0.5,
        expiraInMs: 30 * 24 * 60 * 60 * 1000, // 30 zile
      })
    }

    // 3. Pregătește salutul de dimineață
    salutPregatit = genereazaSalutDimineata(patternuri, episoade.length, emotionale.length, vizuale.length, sonore.length)
  } catch {
    // Visul a eșuat — nu afectează nimic, reîncearcă mâine
  }
}

/** Generează salutul de dimineață din patternurile zilei anterioare. */
function genereazaSalutDimineata(
  patternuri: string[],
  nrEpisoade: number,
  nrEmotionale: number,
  nrVizuale: number,
  nrSonore: number,
): string {
  const partePattern = patternuri.length > 0
    ? ` Am observat ${patternuri.join(', ')}.`
    : ''
  const parteActivitate = nrEpisoade + nrEmotionale > 0
    ? ` Ieri am reținut ${nrEpisoade} episoade și ${nrEmotionale} stări emoționale.`
    : ''
  return `Bună dimineața.${partePattern}${parteActivitate} Te ajut cu ceva?`
}

/** Salutul de dimineață pregătit în timpul somnului. Null dacă nu e pregătit. */
export function getSalutDimineata(): string | null {
  const s = salutPregatit
  if (s) {
    salutPregatit = null // livrat o singură dată
    return s
  }
  return null
}

/** Verifică dacă userul s-a trezit (inactivitate lungă → acum activ). */
export function detecteazaTrezierea(): boolean {
  const acum = Date.now()
  const aFostLungaPauza = acum - ultimaActivitate > PRAG_INACTIVITATE_MS
  if (aFostLungaPauza) {
    ultimaActivitate = acum // reset
    return true
  }
  return false
}
