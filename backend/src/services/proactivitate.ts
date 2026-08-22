// ── INIȚIATIVĂ + PROACTIVITATE (owner, 22 aug 2026: „acționează real") ────────
//
// Kelion nu mai așteaptă să i se ceară. Acest modul verifică periodic:
//   1. Evenimente URGENTE din auzul ambiental (alarmă, spargere, plâns)
//   2. Schimbări de stare emoțională (supărat → oferă suport)
//   3. Observații vizuale semnificative (mișcare mare neașteptată)
//
// Când detectează ceva demn de atenție, generează o notificare proactivă
// pe care creierul o poate trimite prin SSE către client.

import { ultimulEvenimentUrgent, type EvenimentSonorStocat } from './auzAmbiental.js'
import { ultimaStareEmotionala, emotieDominanta, type Emotie } from './memorieEmotionala.js'
import { observatiiRecente } from './vedereContinua.js'

export interface NotificareProactiva {
  ts: number
  tip: 'urgenta_sonora' | 'schimbare_emotionala' | 'observatie_vizuala' | 'rutina'
  prioritate: 'critica' | 'mare' | 'medie' | 'mica'
  titlu: string
  descriere: string
  actiuneSugerata?: string
}

const INTERVAL_VERIFICARE_MS = 30_000 // verifică la 30 secunde
const URGENTE_CRITICE: EvenimentSonorStocat['tip'][] = ['alarma', 'spargere']
const URGENTE_MARI: EvenimentSonorStocat['tip'][] = ['plans', 'sonerie']
let ultimaNotificareUrgenta = 0
let ultimaNotificareEmotionala = 0
let ultimaNotificareVizuala = 0
let ultimaEmotieCunoscuta: Emotie | null = null

/** Verifică toate sursele și generează notificări proactive. */
export function verificaProactivitate(): NotificareProactiva[] {
  const acum = Date.now()
  const notificari: NotificareProactiva[] = []

  // 1. Evenimente sonore urgente
  const urgent = ultimulEvenimentUrgent()
  if (urgent && acum - urgent.ts < 60_000 && acum - ultimaNotificareUrgenta > 60_000) {
    const critica = URGENTE_CRITICE.includes(urgent.tip)
    const mare = URGENTE_MARI.includes(urgent.tip)
    if (critica || mare) {
      ultimaNotificareUrgenta = acum
      notificari.push({
        ts: acum,
        tip: 'urgenta_sonora',
        prioritate: critica ? 'critica' : 'mare',
        titlu: critica ? `ALARMĂ: ${urgent.tip}` : `Sunet important: ${urgent.tip}`,
        descriere: `Am detectat ${urgent.tip} (intensitate ${urgent.intensitate}%, frecvență ${urgent.frecventaDominanta}Hz) acum ${Math.round((acum - urgent.ts) / 1000)}s`,
        actiuneSugerata: critica ? 'Verifică imediat ce se întâmplă' : 'Vrei să verific ce s-a auzit?',
      })
    }
  }

  // 2. Schimbări de stare emoțională
  const emotieCurenta = emotieDominanta()
  if (emotieCurenta && emotieCurenta !== ultimaEmotieCunoscuta && acum - ultimaNotificareEmotionala > 120_000) {
    ultimaEmotieCunoscuta = emotieCurenta
    ultimaNotificareEmotionala = acum
    if (emotieCurenta === 'suparat' || emotieCurenta === 'trist') {
      notificari.push({
        ts: acum,
        tip: 'schimbare_emotionala',
        prioritate: 'medie',
        titlu: `Stare emoțională: ${emotieCurenta}`,
        descriere: `Detectez că ești ${emotieCurenta}. Vrei să vorbim despre asta?`,
        actiuneSugerata: 'Oferă suport empatic, nu forța conversația',
      })
    } else if (emotieCurenta === 'stresat') {
      notificari.push({
        ts: acum,
        tip: 'schimbare_emotionala',
        prioritate: 'mica',
        titlu: 'Stare: stresat',
        descriere: 'Detectez tensiune. Răspunsurile mele vor fi mai concise.',
      })
    }
  }

  // 3. Observații vizuale semnificative
  const obs = observatiiRecente()
  const miscareMare = obs.find((o) => o.miscare > 60 && acum - o.ts < 60_000)
  if (miscareMare && acum - ultimaNotificareVizuala > 120_000) {
    ultimaNotificareVizuala = acum
    notificari.push({
      ts: acum,
      tip: 'observatie_vizuala',
      prioritate: 'mica',
      titlu: 'Mișcare intensă detectată',
      descriere: `Mișcare de ${miscareMare.miscare}% în cadru acum ${Math.round((acum - miscareMare.ts) / 1000)}s`,
    })
  }

  return notificari
}

/** Pornește monitorizarea proactivă. Apelat cu callback pentru notificări. */
export function pornesteProactivitatea(
  laNotificare: (n: NotificareProactiva) => void,
): () => void {
  let inMers = true
  const timer = setInterval(() => {
    if (!inMers) return
    const notificari = verificaProactivitate()
    for (const n of notificari) laNotificare(n)
  }, INTERVAL_VERIFICARE_MS)
  return () => {
    inMers = false
    clearInterval(timer)
  }
}
