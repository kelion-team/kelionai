// ── AUTOVINDECAREA VEDE EȘECURILE MUTE DE PE VIU ────────────────────────────
//
// Adrian, 12 aug: „vreau autonomia si kelion sa vada tot ce pica". Testul
// dovedește că un eșec MUT înregistrat (rută 5xx, chat mut, fără vedere) devine
// ordin de reparație către constructor — fără pragul „2 useri" al erorilor de
// browser, cu recurență cerută doar acolo unde un semnal singular ar fi zgomot,
// și fără duplicat.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const jobs: { scope: string; order: string }[] = []
const kv = new Map<string, string>()
let recurring: unknown[] = []
let simptome: unknown[] = []

vi.mock('../db.js', () => ({
  recurringClientErrors: async () => recurring,
  simptomeLiveRecente: async () => simptome,
  createBuildJob: async (scope: string, order: string) => {
    jobs.push({ scope, order })
    return jobs.length
  },
  loadKv: async (k: string) => kv.get(k) ?? null,
  saveKv: async (k: string, v: string) => {
    kv.set(k, v)
  },
  requeueMoneyFailedBuildJobs: async () => 0,
}))
vi.mock('./runbooks.js', () => ({ isOpsPaused: async () => false }))
vi.mock('./geminiDirect.js', () => ({ geminiLive: async () => ({ ok: false, serving: false }) }))
// Mockat ca să NU tragem autonomie.ts (→ config.ts, chei obligatorii) în test.
let plafon = { activ: false, plafon: 10, cheltuit: 0 }
vi.mock('./autonomie.js', () => ({ plafonConstructor: async () => plafon }))

import { runSelfHeal } from './selfHeal.js'

beforeEach(() => {
  jobs.length = 0
  kv.clear()
  recurring = []
  simptome = []
  plafon = { activ: false, plafon: 10, cheltuit: 0 }
})

const simptom = (fel: string, message: string, count: number, sampleUrl = '') => ({
  fel,
  message,
  count,
  sampleUrl,
  lastSeen: '2026-08-12T10:00:00Z',
})

describe('runSelfHeal — eșecurile mute ajung la reparație', () => {
  it('o rută 5xx (chiar și la 2 apariții, un singur user) → ordin de reparație live cu cauza REALĂ', async () => {
    simptome = [simptom('ruta-crapata', 'POST /api/chat: boom', 3, '/api/chat')]
    const r = await runSelfHeal()
    expect(r.filed).toBe(1)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].scope).toBe('kelion-autovindecare-live')
    expect(jobs[0].order).toContain('POST /api/chat: boom')
  })

  it('„fara-vedere" SUB prag (2 < 5) NU pornește reparație — camera oprită nu e bug (regula #1)', async () => {
    simptome = [simptom('fara-vedere', 'scris: cerere vizuală fără cadru', 2)]
    const r = await runSelfHeal()
    expect(r.filed).toBe(0)
    expect(jobs).toHaveLength(0)
  })

  it('„fara-vedere" recurent (5) → devine reparație', async () => {
    simptome = [simptom('fara-vedere', 'scris: cerere vizuală fără cadru', 5)]
    const r = await runSelfHeal()
    expect(r.filed).toBe(1)
    expect(jobs[0].scope).toBe('kelion-autovindecare-live')
  })

  it('nu duplică același simptom la a doua rulare (dedup pe semnătură)', async () => {
    simptome = [simptom('chat-mut', 'voce: ușa creierului a picat — timeout', 3)]
    await runSelfHeal()
    expect(jobs).toHaveLength(1)
    await runSelfHeal() // aceeași lume — nu mai trimite
    expect(jobs).toHaveLength(1)
  })

  it('plafonul de bani atins → NU mai trimite nicio reparație (B5)', async () => {
    plafon = { activ: true, plafon: 10, cheltuit: 10 }
    simptome = [simptom('ruta-crapata', 'POST /api/chat: boom', 3, '/api/chat')]
    recurring = [{ message: 'x', count: 9, users: 4, sampleStack: null, sampleUrl: '/', firstSeen: '', lastSeen: '' }]
    const r = await runSelfHeal()
    expect(r.filed).toBe(0)
    expect(jobs).toHaveLength(0)
  })

  it('calea veche (erori de browser recurente) rămâne independentă', async () => {
    recurring = [
      { message: 'TypeError x', count: 6, users: 3, sampleStack: null, sampleUrl: '/', firstSeen: '', lastSeen: '' },
    ]
    const r = await runSelfHeal()
    expect(r.filed).toBe(1)
    expect(jobs[0].scope).toBe('kelion-autovindecare')
  })
})
