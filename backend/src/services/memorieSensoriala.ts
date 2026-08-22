// ── MEMORIA SENZORIALĂ UNIFICATĂ (owner, 22 aug 2026: „simte mediu") ──────────
//
// Conectează vederea continuă + auzul ambiental cu memoria tipizată:
// când Kelion vede ceva important (mișcare mare) sau aude ceva urgent
// (alarmă, spargere), salvează automat ca memorie senzorială (tip visual/
// auditory) în DB — ca să poată fi reamintită contextual la cerere.
//
// Nu salvează TOT — doar ce e demn de ținut minte (mișcare > 30%, evenimente
// urgente, schimbări de context ambiental). Altfen ar îneca memoria cu zgomot.

import { addMemory } from '../db.js'
import { observatiiRecente, numarObservatii } from './vedereContinua.js'
import { evenimenteSonoreRecente, evenimenteUrgente } from './auzAmbiental.js'

const PRAG_MISCARE_MEMORABIL = 30 // % mișcare pentru a salva ca memorie vizuală
const INTERVAL_SALVARE_MS = 60_000 // nu salva mai des de o dată pe minut

let ultimaSalvareVizuala = 0
let ultimaSalvareSonora = 0

/** Salvează observațiile vizuale semnificative ca memorie senzorială.
 *  Apelat periodic (din index.ts, la fel ca backfillMemoryEmbeddings). */
export async function salveazaMemorieVizuala(email: string): Promise<void> {
  const acum = Date.now()
  if (acum - ultimaSalvareVizuala < INTERVAL_SALVARE_MS) return
  const obs = observatiiRecente()
  if (obs.length === 0) return
  // Găsește cea mai recentă observație cu mișcare semnificativă
  const semnificative = obs.filter((o) => o.miscare >= PRAG_MISCARE_MEMORABIL)
  if (semnificative.length === 0) return
  ultimaSalvareVizuala = acum
  const ultima = semnificative[semnificative.length - 1]
  const acumMin = Math.round((acum - ultima.ts) / 60_000)
  const locatie = ultima.lat ? ` la ${ultima.lat.toFixed(3)}, ${ultima.lon?.toFixed(3)}` : ''
  const continut = `[VIZUAL] Mișcare ${ultima.miscare}% detectată${locatie} (${acumMin}min în urmă, ${numarObservatii()} observații totale în ultimele 5 min)`
  await addMemory(email, continut, 'kelion', {
    tip: 'visual',
    importanta: 0.45,
    expiraInMs: 3 * 24 * 60 * 60 * 1000, // 3 zile
  }).catch(() => undefined)
}

/** Salvează evenimentele sonore urgente ca memorie senzorială.
 *  Apelat periodic. Doar evenimentele URGENTE (alarma, spargere, plâns). */
export async function salveazaMemorieSonora(email: string): Promise<void> {
  const acum = Date.now()
  if (acum - ultimaSalvareSonora < INTERVAL_SALVARE_MS) return
  const urgente = evenimenteUrgente()
  if (urgente.length === 0) return
  ultimaSalvareSonora = acum
  const ultima = urgente[urgente.length - 1]
  const acumMin = Math.round((acum - ultima.ts) / 60_000)
  const continut = `[AUDITIV] ${ultima.tip.toUpperCase()} detectat — intensitate ${ultima.intensitate}%, frecvență ${ultima.frecventaDominanta}Hz (${acumMin}min în urmă)`
  await addMemory(email, continut, 'kelion', {
    tip: 'auditory',
    importanta: 0.7, // evenimentele urgente sunt importante
    expiraInMs: 7 * 24 * 60 * 60 * 1000, // 7 zile
  }).catch(() => undefined)
}

/** Salvează ambele tipuri de memorie senzorială pentru un user.
 *  Apelat periodic din index.ts (cron, ca backfillMemoryEmbeddings). */
export async function salveazaMemorieSensoriala(email: string): Promise<void> {
  await Promise.all([
    salveazaMemorieVizuala(email),
    salveazaMemorieSonora(email),
  ])
}
