import { describe, it, expect } from 'vitest'
import { istoricPentruLocal, personaLocala, stareCreierLocal, type MesajLocal } from './lib/creierLocal'

// ── CREIERUL LOCAL OFFLINE — părțile PURE (faza 1) ──────────────────────────
// Nu putem proba WebGPU/modelul aici (doar pe device), dar CONTRACTUL pur —
// persona cinstită + preluarea contextului chatului — se probează fără GPU.

describe('personaLocala — persona offline, cinstită, în limba userului', () => {
  it('cere răspuns în limba userului (numele limbii, nu cod)', () => {
    expect(personaLocala('ro')).toContain('Romanian')
    expect(personaLocala('en')).toContain('English')
    expect(personaLocala('de')).toContain('German')
  })
  it('spune CINSTIT că e offline și companion (nu asistent complet, fără net)', () => {
    const p = personaLocala('ro').toLowerCase()
    expect(p).toContain('offline')
    expect(p).toContain('companion')
    expect(p).toContain('no internet')
  })
})

describe('istoricPentruLocal — PRELUAREA contextului chatului', () => {
  const mesaje: MesajLocal[] = [
    { role: 'user', content: 'salut' },
    { role: 'assistant', content: 'bună' },
    { role: 'system', content: 'ignoră-mă' }, // rol necunoscut → filtrat
    { role: 'user', content: '   ' }, // gol → filtrat
    { role: 'user', content: 'ce faci?' },
  ]

  it('pune persona (system) prima și preia turele reale, în ordine', () => {
    const out = istoricPentruLocal(mesaje, 'ro')
    expect(out[0].role).toBe('system')
    expect(out[0].content).toBe(personaLocala('ro'))
    // Doar user/assistant ne-goale, în ordine.
    expect(out.slice(1)).toEqual([
      { role: 'user', content: 'salut' },
      { role: 'assistant', content: 'bună' },
      { role: 'user', content: 'ce faci?' },
    ])
  })

  it('păstrează DOAR ultimele N ture (context, nu tot istoricul)', () => {
    const multe: MesajLocal[] = Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: `m${i}` }))
    const out = istoricPentruLocal(multe, 'en', 5)
    expect(out[0].role).toBe('system') // persona rămâne mereu prima
    const ture = out.slice(1)
    expect(ture).toHaveLength(5)
    expect(ture[0].content).toBe('m25') // ultimele 5
    expect(ture[4].content).toBe('m29')
  })
})

describe('stareCreierLocal — pornește onest, nu pretinde „gata"', () => {
  it('starea inițială e „neintrodus" (nimic măsurat încă), progres 0', () => {
    const s = stareCreierLocal()
    expect(s.stare).toBe('neintrodus')
    expect(s.progres).toBe(0)
  })
})
