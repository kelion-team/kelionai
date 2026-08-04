import { creeazaMotorBit, type StareBit } from './motorBit'

// ── DANSUL PE MUZICA DIN CAMERĂ (Adrian, 4 aug: „cât e muzică... motor de
// sincronizare bitrate pe dans", sursă: microfonul) ──────────────────────────
//
// Ia stream-ul microfonului (același pe care Kelion îl folosește pentru voce),
// îi ascultă energia de BAS printr-un AnalyserNode (tap pasiv, nu-l consumă) și
// pe fiecare BIT cheamă `peBit`. Când începe/încetează MUZICA, anunță prin
// `muzicaOn`/`muzicaOff` — panoul oprește vorbitul peste muzică și pornește/
// oprește dansul. Regulile de bit stau în motorBit.ts (testate).

export interface HandlereDans {
  peBit: (s: StareBit) => void
  muzicaOn: (bpm: number) => void
  muzicaOff: () => void
}

type CtorAC = typeof AudioContext

function ctorAudioContext(): CtorAC | null {
  return (
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: CtorAC }).webkitAudioContext ??
    null
  )
}

/** Pornește ascultarea bitului pe stream-ul dat. Întoarce un `stop()` care
 *  desface totul (analizor + AudioContext + bucla de cadre). */
export function pornesteDansPeMuzica(stream: MediaStream, h: HandlereDans): () => void {
  const AC = ctorAudioContext()
  if (!AC) return () => {}
  let ctx: AudioContext
  try {
    ctx = new AC()
  } catch {
    return () => {}
  }
  const sursa = ctx.createMediaStreamSource(stream)
  const analiza = ctx.createAnalyser()
  analiza.fftSize = 1024
  analiza.smoothingTimeConstant = 0.5
  sursa.connect(analiza)
  // NU conectăm analiza la destinație — e doar un tap, nu redăm nimic.

  const spectru = new Uint8Array(analiza.frequencyBinCount)
  const motor = creeazaMotorBit()
  let muzicaAcum = false
  let raf = 0
  let oprit = false
  const t0 = performance.now()

  const cadru = (): void => {
    if (oprit) return
    analiza.getByteFrequencyData(spectru)
    // Energia BENZII DE BAS (primele ~8 binuri ≈ 0–350 Hz la 44.1kHz/1024) —
    // acolo stă „toba" pe care se simte bitul. Normalizată 0..1.
    let suma = 0
    const benziBas = 8
    for (let i = 0; i < benziBas; i++) suma += spectru[i]
    const energie = suma / (benziBas * 255)

    const s = motor.pas(energie, performance.now() - t0)
    if (s.bit) h.peBit(s)
    if (s.muzica && !muzicaAcum) {
      muzicaAcum = true
      h.muzicaOn(s.bpm)
    } else if (!s.muzica && muzicaAcum) {
      muzicaAcum = false
      h.muzicaOff()
    }
    raf = requestAnimationFrame(cadru)
  }
  raf = requestAnimationFrame(cadru)

  return () => {
    oprit = true
    cancelAnimationFrame(raf)
    try {
      sursa.disconnect()
    } catch {
      /* deja desfăcut */
    }
    void ctx.close().catch(() => {})
  }
}
