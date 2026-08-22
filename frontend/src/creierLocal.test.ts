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

// ── CONTORUL DE EȘECURI PERSISTAT (lot A) — restanța din registru ───────────
// „contorul de eșecuri n-are teste" (RAMAS). Cele 6 muchii ale porții
// autoDescarcareaPermisa, probate pe localStorage mockat (node nu-l are).
import { vi, beforeEach } from 'vitest'
import { autoDescarcareaPermisa } from './lib/creierLocal'

const CHEIE = 'kelion_model_offline_esecuri'
// numele modelului e pinuit intenționat: dacă MODEL_LOCAL se schimbă,
// testul muchiei 2 („alt model → contorul vechi nu blochează") rămâne valid,
// iar muchiile 3-5 pică zgomotos și cer actualizarea — exact ce vrem.
const MODEL = 'gemma-2-9b-it-q4f16_1-MLC'
const ORA = 60 * 60 * 1000

const depozit = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => depozit.get(k) ?? null,
  setItem: (k: string, v: string) => void depozit.set(k, v),
  removeItem: (k: string) => void depozit.delete(k),
  clear: () => depozit.clear(),
})

describe('autoDescarcareaPermisa — poarta contorului de eșecuri (fără UI, fără buclă arsă)', () => {
  beforeEach(() => depozit.clear())

  it('fără nicio urmă de eșec → descarcă (muchia 1)', () => {
    expect(autoDescarcareaPermisa()).toBe(true)
  })
  it('eșecurile ALTUI model nu blochează modelul curent (muchia 2 — schimbarea modelului repornește curat)', () => {
    depozit.set(CHEIE, JSON.stringify({ model: 'alt-model-vechi', n: 99, la: Date.now() }))
    expect(autoDescarcareaPermisa()).toBe(true)
  })
  it('sub prag (n<3) pe același model → mai încearcă (muchia 3)', () => {
    depozit.set(CHEIE, JSON.stringify({ model: MODEL, n: 2, la: Date.now() }))
    expect(autoDescarcareaPermisa()).toBe(true)
  })
  it('la prag, cu eșecul PROASPĂT → NU mai descarcă azi (muchia 4 — dispozitivul blocat nu arde date la fiecare pornire)', () => {
    depozit.set(CHEIE, JSON.stringify({ model: MODEL, n: 3, la: Date.now() }))
    expect(autoDescarcareaPermisa()).toBe(false)
  })
  it('la prag, dar a trecut o zi → O încercare nouă (muchia 5 — spațiu eliberat = se repară singură, tot fără UI)', () => {
    depozit.set(CHEIE, JSON.stringify({ model: MODEL, n: 3, la: Date.now() - 25 * ORA }))
    expect(autoDescarcareaPermisa()).toBe(true)
  })
  it('urmă coruptă (JSON stricat / tipuri greșite) → tratată ca inexistentă, nu blochează (muchia 6)', () => {
    depozit.set(CHEIE, 'nu-e-json{')
    expect(autoDescarcareaPermisa()).toBe(true)
    depozit.set(CHEIE, JSON.stringify({ model: 42, n: 'trei', la: 'ieri' }))
    expect(autoDescarcareaPermisa()).toBe(true)
  })
})
