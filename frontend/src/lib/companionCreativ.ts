// ── #8 COMPANION CREATIV (owner, 22 aug 2026: „uimește-mă") ─────────────────
//
// Când ești trist, Kelion compune o melodie liniștitoare (Web Audio API).
// Când ești energic, un beat rapid. Când ești pensive, un ambient.
// Nu playlist — compoziție originală, generată din starea ta emoțională.
//
// Generativ, nu pre-înregistrat: note aleatoare pe o scară, cu ritm și
// armonie adaptate emoției. Web Audio API pur — zero dependențe.

export type DispozitieMuzicala = 'trist' | 'vesel' | 'calm' | 'energic' | 'pensive'

interface ConfigMuzicala {
  scara: number[] // frecvențe (Hz) pentru scară
  tempoBpm: number
  tipOscilator: OscillatorType
  volum: number
  reverb: number // 0-1 — cât de mult echo
  durataNota: number // secunde
}

let ctx: AudioContext | null = null
let inMers = false
let timer: ReturnType<typeof setInterval> | null = null
let nodVolum: GainNode | null = null

/** Configurația muzicală pentru fiecare dispoziție. */
function configPentruDispozitie(d: DispozitieMuzicala): ConfigMuzicala {
  // Scara minoră pentru trist/pensive, majoră pentru vesel/energic
  const A2 = 110, C3 = 130.81, D3 = 146.83, E3 = 164.81, G3 = 196, A3 = 220
  const C4 = 261.63, D4 = 293.66, E4 = 329.63, G4 = 392, A4 = 440
  switch (d) {
    case 'trist':
      return {
        scara: [A2, C3, D3, E3, G3, A3, C4], // minoră
        tempoBpm: 60,
        tipOscilator: 'sine',
        volum: 0.15,
        reverb: 0.6,
        durataNota: 2.0,
      }
    case 'vesel':
      return {
        scara: [C4, D4, E4, G4, A4, C4 * 2], // majoră pentatonică
        tempoBpm: 120,
        tipOscilator: 'triangle',
        volum: 0.2,
        reverb: 0.3,
        durataNota: 0.5,
      }
    case 'energic':
      return {
        scara: [C4, E4, G4, A4, C4 * 2, E4 * 2],
        tempoBpm: 140,
        tipOscilator: 'sawtooth',
        volum: 0.18,
        reverb: 0.2,
        durataNota: 0.3,
      }
    case 'pensive':
      return {
        scara: [A2, D3, E3, A3, D4, E4],
        tempoBpm: 70,
        tipOscilator: 'sine',
        volum: 0.12,
        reverb: 0.8,
        durataNota: 1.5,
      }
    case 'calm':
    default:
      return {
        scara: [C3, D3, E3, G3, A3, C4],
        tempoBpm: 80,
        tipOscilator: 'sine',
        volum: 0.1,
        reverb: 0.5,
        durataNota: 1.0,
      }
  }
}

/** Pornește compoziția pentru o dispoziție. */
export function pornesteMuzica(dispozitie: DispozitieMuzicala): void {
  if (inMers) opresteMuzica()
  if (!ctx) {
    try { ctx = new AudioContext() } catch { return }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  inMers = true

  const cfg = configPentruDispozitie(dispozitie)
  nodVolum = ctx.createGain()
  nodVolum.gain.value = cfg.volum
  nodVolum.connect(ctx.destination)

  const intervalMs = (60 / cfg.tempoBpm) * 1000
  let idxNota = 0

  const playNota = (): void => {
    if (!inMers || !ctx || !nodVolum) return
    // Nota aleatoare din scară (cu preferință pentru mișcare treptată)
    const salt = Math.random() < 0.7 ? 1 : Math.floor(Math.random() * 3) - 1
    idxNota = Math.max(0, Math.min(cfg.scara.length - 1, idxNota + salt))
    if (Math.random() < 0.2) idxNota = Math.floor(Math.random() * cfg.scara.length)
    const freq = cfg.scara[idxNota]

    const osc = ctx.createOscillator()
    osc.type = cfg.tipOscilator
    osc.frequency.value = freq

    // Envelope (attack + decay)
    const gain = ctx.createGain()
    const acum = ctx.currentTime
    gain.gain.setValueAtTime(0, acum)
    gain.gain.linearRampToValueAtTime(1, acum + 0.05) // attack
    gain.gain.exponentialRampToValueAtTime(0.001, acum + cfg.durataNota) // decay

    osc.connect(gain)
    gain.connect(nodVolum)
    osc.start(acum)
    osc.stop(acum + cfg.durataNota + 0.1)

    // Armonie: uneori adaugă o a treia (acord)
    if (Math.random() < 0.3) {
      const osc2 = ctx.createOscillator()
      osc2.type = cfg.tipOscilator
      osc2.frequency.value = freq * 1.25 // terța
      const gain2 = ctx.createGain()
      gain2.gain.setValueAtTime(0, acum)
      gain2.gain.linearRampToValueAtTime(0.5, acum + 0.05)
      gain2.gain.exponentialRampToValueAtTime(0.001, acum + cfg.durataNota)
      osc2.connect(gain2)
      gain2.connect(nodVolum)
      osc2.start(acum)
      osc2.stop(acum + cfg.durataNota + 0.1)
    }
  }

  playNota()
  timer = setInterval(playNota, intervalMs)
}

/** Oprește compoziția. */
export function opresteMuzica(): void {
  inMers = false
  if (timer) { clearInterval(timer); timer = null }
  if (nodVolum) {
    // Fade out
    try {
      nodVolum.gain.exponentialRampToValueAtTime(0.001, ctx!.currentTime + 1)
    } catch { /* tăcut */ }
    setTimeout(() => {
      try { nodVolum?.disconnect() } catch { /* tăcut */ }
      nodVolum = null
    }, 1100)
  }
}

/** Muzica e în curs? */
export function muzicaInMers(): boolean {
  return inMers
}

/** Schimbă dispoziția (fără să oprești). */
export function schimbaDispozitie(d: DispozitieMuzicala): void {
  if (inMers) {
    pornesteMuzica(d) // restart cu noua dispoziție
  }
}
