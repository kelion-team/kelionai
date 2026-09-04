// ── #7 AUDIO SPAȚIAL 3D (owner, 22 aug 2026: „uimește-mă") ──────────────────
//
// Vocea lui Kelion vine dintr-o direcție specifică în spațiu (Web Audio API
// PannerNode). Dacă avatarul e în colțul din dreapta, vocea vine din dreapta.
// Pe căști, simți că e cineva în cameră. Pe mașină, vocea vine din direcția
// avatarului.
//
// Poziția avatarului se actualizează din Stage.tsx (când avatarul se mută
// în colț la chat, sau în centru la dans).

import { obtineAudioContext } from './audioContextPartajat'

// Contextul e cel PARTAJAT al aplicației (audioContextPartajat.ts); dacă a fost
// închis între timp, panner-ul se reconstruiește pe contextul nou.
let ctx: AudioContext | null = null
let panner: PannerNode | null = null
let listener: AudioListener | null = null

/** Inițializează contextul audio spațial. */
export function initiazaAudioSpatial(): void {
  const partajat = obtineAudioContext()
  if (!partajat) return
  if (ctx === partajat && panner) return
  try {
    ctx = partajat
    panner = ctx.createPanner()
    panner.panningModel = 'HRTF' // Head-Related Transfer Functions — realism maxim pe căști
    panner.distanceModel = 'inverse'
    panner.refDistance = 1
    panner.maxDistance = 100
    panner.rolloffFactor = 0.5
    listener = ctx.listener
    // Listener la origine, uitând spre -Z (standard)
    if (listener.positionX) {
      listener.positionX.value = 0
      listener.positionY.value = 0
      listener.positionZ.value = 0
    } else {
      // Safari/older browsers: setPosition
      ;(listener as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(0, 0, 0)
    }
  } catch { /* Web Audio indisponibil */ }
}

/** Resume context (necesitar după gestul userului pe mobil). */
export function resumeAudioSpatial(): void {
  if (ctx?.state === 'suspended') {
    void ctx.resume().catch(() => {})
  }
}
