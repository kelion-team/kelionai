// ── UN SINGUR AudioContext PENTRU TOATĂ APLICAȚIA ────────────────────────────
//
// DE CE (4 sept 2026, „chatul audio live rupe aplicația"): Chrome refuză peste
// 6 AudioContext-uri per document — al șaptelea constructor ARUNCĂ
// `NotSupportedError`. Aplicația ținea PATRU deschise permanent (nivelul vocii,
// soneria, audio spațial, companionul creativ), niciodată închise, iar sesiunea
// vocală mai deschidea DOUĂ la fiecare pornire. 4 + 2 = 6; la prima reluare a
// vocii (sau cu orbul/dictarea vii) constructorul pica → sesiunea moare imediat
// după „session ready" → reluare → aceeași cădere, în buclă, la ~25 s.
//
// AICI: un singur context, creat leneș la prima nevoie și REUTILIZAT de toți
// consumatorii. Se armează singur pe gest (mobilul îl naște 'suspended') și,
// dacă cineva l-a închis (sau browserul l-a dat 'closed'), următorul apel îl
// re-creează curat. Nodurile fiecărui consumator se construiesc PE ACEST
// context; consumatorii NU îl închid — își deconectează doar nodurile proprii.
//
// Ținta: niciodată mai mult de 2–3 contexte vii simultan (cel partajat +
// eventual dictarea / orbul, care au ciclul lor de viață propriu).

import { deblocheazaAudioLaGest } from './audioGraph'

let ctx: AudioContext | null = null
let deblocajArmat = false

/** Constructorul de AudioContext, cu prefixul vechi webkit (Safari). */
function constructorAudioContext(): typeof AudioContext | null {
  return (
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null
  )
}

function esteViu(c: AudioContext | null): c is AudioContext {
  return !!c && c.state !== 'closed'
}

/** Mobilul naște contextul 'suspended' până la un gest. Armăm deblocajul o
 *  singură dată per context (ascultătoarele se retrag singure). */
function armeazaDeblocajul(c: AudioContext): void {
  if (deblocajArmat || c.state === 'running') return
  deblocajArmat = true
  deblocheazaAudioLaGest(c)
}

/** Contextul audio partajat al aplicației. Creează leneș, reutilizează cât e
 *  viu, re-creează după `close`. Întoarce `null` doar dacă browserul nu are
 *  Web Audio sau constructorul aruncă (ex. plafonul de contexte al Chrome). */
export function obtineAudioContext(): AudioContext | null {
  if (esteViu(ctx)) {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    return ctx
  }
  ctx = null
  deblocajArmat = false
  const AC = constructorAudioContext()
  if (!AC) return null
  let nou: AudioContext
  try {
    nou = new AC()
  } catch {
    return null
  }
  ctx = nou
  // Când contextul moare (close extern / browser), uităm referința ca următorul
  // apel să facă unul nou — nu să împartă un cadavru.
  try {
    nou.addEventListener('statechange', () => {
      if (nou.state === 'closed' && ctx === nou) {
        ctx = null
        deblocajArmat = false
      }
    })
  } catch {
    /* implementări minimale fără EventTarget — ne bazăm pe verificarea din obtine */
  }
  armeazaDeblocajul(nou)
  return nou
}

/** Contextul viu, dacă există deja — fără să creeze unul. */
export function audioContextCurent(): AudioContext | null {
  return esteViu(ctx) ? ctx : null
}

/** Închide contextul partajat (rar: teste, oprirea completă a audio-ului).
 *  Următorul `obtineAudioContext()` va crea unul nou. */
export async function inchideAudioContextPartajat(): Promise<void> {
  const c = ctx
  ctx = null
  deblocajArmat = false
  if (!esteViu(c)) return
  try {
    await c.close()
  } catch {
    /* deja închis */
  }
}
