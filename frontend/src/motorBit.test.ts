import { describe, it, expect } from 'vitest'
import { creeazaMotorBit } from './lib/motorBit'

// Simulează energia audio: un vârf scurt la fiecare bit, liniște între ele.
// La 120 BPM = un bit la 500ms. Cadre la 20ms (~50fps, ca requestAnimationFrame).
function ruleaza(bpmReal: number, secunde: number): { biti: number; muzica: boolean; bpm: number } {
  const motor = creeazaMotorBit()
  const perioada = 60000 / bpmReal
  let biti = 0
  let muzica = false
  let bpm = 0
  for (let t = 0; t <= secunde * 1000; t += 20) {
    const dinBit = t % perioada
    const energie = dinBit < 40 ? 0.6 : 0.03 // vârf 40ms pe bit, fond mic între
    const s = motor.pas(energie, t)
    if (s.bit) biti++
    muzica = s.muzica
    bpm = s.bpm
  }
  return { biti, muzica, bpm }
}

describe('motorBit — detectă bitul și tempoul din energie', () => {
  it('prinde biții la 120 BPM (~2/secundă)', () => {
    const r = ruleaza(120, 5)
    // ~10 biți în 5s la 120 BPM (toleranță pentru încălzirea mediei).
    expect(r.biti).toBeGreaterThanOrEqual(7)
    expect(r.biti).toBeLessThanOrEqual(12)
  })

  it('declară MUZICĂ pe ritm susținut, cu BPM plauzibil', () => {
    const r = ruleaza(128, 6)
    expect(r.muzica).toBe(true)
    expect(r.bpm).toBeGreaterThanOrEqual(110)
    expect(r.bpm).toBeLessThanOrEqual(145)
  })

  it('liniște = fără biți, fără muzică', () => {
    const motor = creeazaMotorBit()
    let biti = 0
    let muzica = false
    for (let t = 0; t <= 4000; t += 20) {
      const s = motor.pas(0.005, t) // fond foarte mic, constant
      if (s.bit) biti++
      muzica = muzica || s.muzica
    }
    expect(biti).toBe(0)
    expect(muzica).toBe(false)
  })

  it('un vârf izolat (o bătaie din palme) NU e declarat muzică', () => {
    const motor = creeazaMotorBit()
    let muzica = false
    for (let t = 0; t <= 4000; t += 20) {
      const energie = t >= 1000 && t < 1040 ? 0.7 : 0.02
      const s = motor.pas(energie, t)
      muzica = muzica || s.muzica
    }
    expect(muzica).toBe(false)
  })
})
