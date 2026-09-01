// ── OCHII AUTOVINDECĂRII — piesele pure, probate ────────────────────────────
//
// Ce păzește: `pareCerereVizuala` prinde cererea vizuală dar NU se aprinde pe
// orice (regula #1 — nu punem în cârcă o „vedere picată" când camera e legitim
// oprită).
import { describe, it, expect } from 'vitest'
import { pareCerereVizuala } from './simptomeLive.js'

describe('pareCerereVizuala — vizual da, restul nu', () => {
  it('cereri vizuale → da', () => {
    for (const t of [
      'ce vezi pe ecran?',
      'uită-te la mine',
      'poți citi ce scrie aici?',
      'arată-mi ce e în poză',
      'what do you see',
      'read this for me',
      'ce apare pe monitor',
    ]) {
      expect(pareCerereVizuala(t), t).toBe(true)
    }
  })

  it('cereri ne-vizuale → nu (fără fals pozitive)', () => {
    for (const t of [
      'cât e ceasul?',
      'spune-mi o glumă',
      'deschide harta spre Cluj',
      'cum te simți azi',
      '',
    ]) {
      expect(pareCerereVizuala(t), t).toBe(false)
    }
  })
})
