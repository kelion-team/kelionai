// ── GUARD pentru PROBA LIVE (apără BANII, nu bifează) ────────────────────────
//
// Proba REALĂ e rularea pe serverul viu (probaChatLive, orară). Guard-ul ăsta
// păzește DOAR ca decizia să nu trimită reparații false pe cheltuiala owner-ului:
// creier mut → simptom „chat-mut" (reparabil); creier fără credit → „creier-
// indisponibil" (vizibil, dar NU reparat); răspuns bun → niciun simptom.
import { describe, it, expect, beforeEach, vi } from 'vitest'

let brainRaspuns = 'ok'
let gemini: { ok: boolean; serving: boolean; reason?: string } = { ok: true, serving: true }
const simptome: string[] = []

vi.mock('./brain.js', () => ({ brainComplete: async () => brainRaspuns }))
vi.mock('./geminiDirect.js', () => ({ geminiLive: async () => gemini }))
vi.mock('../db.js', () => ({
  recordSimptomLive: async (fel: string) => { simptome.push(fel) },
  saveKv: async () => {},
}))
vi.mock('./autonomActiv.js', () => ({ autonomActiv: async () => true }))
vi.mock('./autonomie.js', () => ({ plafonConstructor: async () => ({ activ: false, plafon: 0, cheltuit: 0 }) }))
vi.mock('./runbooks.js', () => ({ isOpsPaused: async () => false }))

import { probaChatLive } from './probaLive.js'

beforeEach(() => {
  brainRaspuns = 'ok'
  gemini = { ok: true, serving: true }
  simptome.length = 0
})

describe('probaChatLive — decizia care apără banii', () => {
  it('răspuns real → OK, niciun simptom (nicio reparație)', async () => {
    const r = await probaChatLive()
    expect(r.ok).toBe(true)
    expect(simptome).toHaveLength(0)
  })

  it('creierul servește dar tura e mută → simptom „chat-mut" (reparabil)', async () => {
    brainRaspuns = '   '
    const r = await probaChatLive()
    expect(r.ok).toBe(false)
    expect(simptome).toEqual(['chat-mut'])
  })

  it('creier fără credit → „creier-indisponibil" (vizibil, dar NU reparat)', async () => {
    gemini = { ok: true, serving: false, reason: 'depleted' }
    const r = await probaChatLive()
    expect(r.ok).toBe(false)
    expect(simptome).toEqual(['creier-indisponibil'])
  })
})
