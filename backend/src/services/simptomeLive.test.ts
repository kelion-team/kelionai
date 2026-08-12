// ── OCHII AUTOVINDECĂRII — piesele pure, probate ────────────────────────────
//
// Ce păzește: `pareCerereVizuala` prinde cererea vizuală dar NU se aprinde pe
// orice (regula #1 — nu punem în cârcă o „vedere picată" când camera e legitim
// oprită); `ordinSimptomLive` scrie un ordin îndreptat spre CAUZĂ; pragurile pe
// fel cer recurență acolo unde un semnal singular ar fi zgomot.
import { describe, it, expect } from 'vitest'
import { pareCerereVizuala, ordinSimptomLive, pragPentru } from './simptomeLive.js'

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

describe('ordinSimptomLive — îndreptat spre cauză', () => {
  it('conține ce a picat și cere mersul la cauză', () => {
    const o = ordinSimptomLive('ruta-crapata', 'POST /api/chat: boom', 3, '/api/chat')
    expect(o).toContain('POST /api/chat: boom')
    expect(o).toContain('MERGI LA CAUZĂ')
    expect(o).toContain('server_logs')
  })
  it('la „fara-vedere" cere întâi să distingă bug real de camera oprită (regula #1)', () => {
    const o = ordinSimptomLive('fara-vedere', 'scris: cerere vizuală fără cadru', 5)
    expect(o).toContain('BUG REAL')
  })
  it('la „chat-mut" spune limpede că e „aplicația nu răspunde"', () => {
    const o = ordinSimptomLive('chat-mut', 'voce: ușa creierului a picat', 2)
    expect(o).toContain('nu răspunde')
  })
})

describe('pragPentru — recurență cerută doar unde un semnal singular ar fi zgomot', () => {
  it('„fara-vedere" cere recurență (5); restul pornesc de la 2', () => {
    expect(pragPentru('fara-vedere')).toBe(5)
    expect(pragPentru('ruta-crapata')).toBe(2)
    expect(pragPentru('chat-mut')).toBe(2)
    expect(pragPentru('orice-altceva')).toBe(2)
  })
})
