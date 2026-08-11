// ── MESSENGER — SONERIA DE APEL (Adrian: „sonerie/anunț vocal") ──────────────────
// Un ton scurt „ring-ring" repetat cât sună un apel primit, generat cu WebAudio
// (fără fișier de sunet). Best-effort: dacă AudioContext-ul e blocat (fără gest
// prealabil pe pagină), rămâne doar anunțul vocal + interfața — nu stricăm nimic.
let ctx: AudioContext | null = null
let timer: number | null = null

function acum(): AudioContext | null {
  const AC =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  try {
    ctx = ctx ?? new AC()
  } catch {
    return null
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
  return ctx
}

function bip(): void {
  const c = acum()
  if (!c) return
  const t0 = c.currentTime
  // Două tonuri scurte (ring-ring), blânde.
  for (const [dt, f] of [
    [0, 880],
    [0.2, 660],
  ] as [number, number][]) {
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = f
    g.gain.setValueAtTime(0.0001, t0 + dt)
    g.gain.exponentialRampToValueAtTime(0.22, t0 + dt + 0.03)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.18)
    osc.connect(g)
    g.connect(c.destination)
    osc.start(t0 + dt)
    osc.stop(t0 + dt + 0.2)
  }
}

export function pornesteSonerie(): void {
  if (timer !== null) return
  bip()
  timer = window.setInterval(bip, 2200)
}

export function opresteSonerie(): void {
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
}
