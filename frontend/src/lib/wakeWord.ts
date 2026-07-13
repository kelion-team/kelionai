// CUVÂNT DE TREZIRE (Adrian: „detecția... s-a cerut de mai multe ori") — mâini
// libere: Kelion ascultă în fundal și, când aude numele („Kelion" / „Hei
// Kelion"), pornește singur microfonul, fără să apeși nimic.
//
// Implementare KEY-FREE cu Web Speech API (recunoaștere continuă, pe Chrome).
// Zero chei, zero modele de descărcat. Complet opt-in (un buton), pornit doar
// când vrei. Pentru varianta 100% pe-dispozitiv/offline (Picovoice Porcupine)
// e nevoie de o cheie + model .ppn — upgrade separat; ăsta merge acum.

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}
type SRCtor = new () => SpeechRecognitionLike

function getCtor(): SRCtor | null {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function wakeWordSupported(): boolean {
  return typeof window !== 'undefined' && getCtor() !== null
}

/**
 * Pornește ascultarea cuvântului de trezire. Când transcrierea conține unul din
 * `triggers`, cheamă `onWake` (cu un debounce de 3s ca să nu se declanșeze în
 * rafală). Recunoscătorul se REPORNEȘTE singur când se oprește (continuous se
 * închide periodic în Chrome). Întoarce o funcție de oprire. Cade grațios dacă
 * API-ul nu există.
 */
export function startWakeWord(triggers: string[], onWake: () => void, lang = 'ro-RO'): () => void {
  const Ctor = getCtor()
  if (!Ctor) return () => {}
  const rec = new Ctor()
  rec.continuous = true
  rec.interimResults = true
  rec.lang = lang
  const trig = triggers.map((t) => t.toLowerCase().trim()).filter(Boolean)
  let stopped = false
  let lastFire = 0

  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const txt = (e.results[i]?.[0]?.transcript ?? '').toLowerCase()
      if (trig.some((t) => txt.includes(t))) {
        const now = Date.now()
        if (now - lastFire > 3000) {
          lastFire = now
          try {
            onWake()
          } catch {
            /* callback-ul nu trebuie să omoare ascultarea */
          }
        }
      }
    }
  }
  // Recunoscătorul continuu se închide singur din când în când (și pe eroare de
  // rețea) — îl repornim cât timp nu am cerut oprire explicită.
  rec.onend = () => {
    if (stopped) return
    try {
      rec.start()
    } catch {
      /* deja pornit / stare tranzitorie */
    }
  }
  rec.onerror = () => {
    /* onend se va ocupa de repornire */
  }
  try {
    rec.start()
  } catch {
    return () => {}
  }
  return () => {
    stopped = true
    try {
      rec.stop()
    } catch {
      /* deja oprit */
    }
  }
}
