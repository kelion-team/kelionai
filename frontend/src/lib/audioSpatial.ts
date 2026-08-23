// ── #7 AUDIO SPAȚIAL 3D (owner, 22 aug 2026: „uimește-mă") ──────────────────
//
// Vocea lui Kelion vine dintr-o direcție specifică în spațiu (Web Audio API
// PannerNode). Dacă avatarul e în colțul din dreapta, vocea vine din dreapta.
// Pe căști, simți că e cineva în cameră. Pe mașină, vocea vine din direcția
// avatarului.
//
// Poziția avatarului se actualizează din Stage.tsx (când avatarul se mută
// în colț la chat, sau în centru la dans).

let ctx: AudioContext | null = null
let panner: PannerNode | null = null
let listener: AudioListener | null = null

/** Inițializează contextul audio spațial. */
export function initiazaAudioSpatial(): void {
  if (ctx) return
  try {
    ctx = new AudioContext()
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

/** Actualizează poziția sursei vocii (avatarul) în spațiu 3D.
 *  @param x -1 = stânga, 0 = centru, 1 = dreapta
 *  @param y 0 = nivel urechi, 1 = deasupra
 *  @param z 0 = la urechi, 1 = în față */
export function setPozitieAvatar(x: number, y: number, z: number): void {
  if (!panner) return
  // Scala la metri (1 unitate = 1 metru)
  const distX = x * 2 // max 2m stânga/dreapta
  const distY = y * 0.5 // max 0.5m sus
  const distZ = z * 1.5 // max 1.5m în față
  if (panner.positionX) {
    panner.positionX.value = distX
    panner.positionY.value = distY
    panner.positionZ.value = distZ
  } else {
    ;(panner as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(distX, distY, distZ)
  }
}

/** Conectează o sursă audio la pannerul spațial.
 *  Returnează nodul de intrare în care se conectează sursa. */
export function getNodIntrareSpatial(): AudioNode | null {
  if (!panner || !ctx) return null
  // Panner → destination
  if (panner.numberOfOutputs > 0 && !panner.context.destination) {
    panner.connect(ctx.destination)
  }
  return panner
}

/** Conectează un MediaStream (ex: audio de la TTS) la audio spațial. */
export function conecteazaStreamSpatial(stream: MediaStream): void {
  if (!ctx || !panner) return
  try {
    const sursa = ctx.createMediaStreamSource(stream)
    sursa.connect(panner)
    panner.connect(ctx.destination)
  } catch { /* tăcut */ }
}

/** Resume context (necesitar după gestul userului pe mobil). */
export function resumeAudioSpatial(): void {
  if (ctx?.state === 'suspended') {
    void ctx.resume().catch(() => {})
  }
}

/** Oprește și curăță audio spațial. */
export function opresteAudioSpatial(): void {
  if (panner) { try { panner.disconnect() } catch { /* tăcut */ } panner = null }
  if (ctx) { try { ctx.close() } catch { /* tăcut */ } ctx = null }
  listener = null
}
