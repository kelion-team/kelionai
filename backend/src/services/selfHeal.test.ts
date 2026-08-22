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
let ordineMoarte: { id: number; orderText: string; log: string; attempts: number }[] = []
// P27: golurile RAPORTATE lui Kelion (triaj) — capturate ca să se poată afirma.
const goluri: { request: string; reason: string }[] = []

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
  listFailedBuildJobsRecent: async () => ordineMoarte,
  logCapabilityGap: async (_email: string, request: string, reason: string) => {
    goluri.push({ request, reason })
    return true
  },
  // „Un doctor pe pacient": ordinele depuse în test se numără drept ACTIVE pe
  // sursa lor — exact ca în DB (create = queued), deci zgarda de unicat e reală.
  activeBuildJobsByScope: async (scope: string) => jobs.filter((j) => j.scope === scope).length,
}))
vi.mock('./runbooks.js', () => ({ isOpsPaused: async () => false }))
vi.mock('./geminiDirect.js', () => ({ geminiLive: async () => ({ ok: false, serving: false }) }))
// Mockat ca să NU tragem autonomie.ts (→ config.ts, chei obligatorii) în test.
let plafon = { activ: false, plafon: 10, cheltuit: 0 }
vi.mock('./autonomie.js', () => ({ plafonConstructor: async () => plafon }))
// MÂNA AIDER (16 aug): mockăm lucrătorul + PR-ul ca verdictul buclei să fie al
// nostru în test — aiderPropune=null înseamnă „aider neinstalat" (drumul vechi).
let aiderPropune: { aSchimbat: boolean; testeTrec: boolean | null; branch?: string } | null = null
vi.mock('./lucratori.js', () => ({
  LUCRATORI: [{ nume: 'aider' }],
  lucratoriInstalati: async () => (aiderPropune ? ['aider'] : []),
  ruleazaLucrator: async () => ({
    lucrator: 'aider', model: 'gemini/test', ok: true, diff: '', log: '', secunde: 1,
    fisiere: 1, adaugate: 5, sterse: 2, ...aiderPropune,
  }),
}))
const prDeschise: string[] = []
vi.mock('./github.js', () => ({
  repoOpenPR: async (branch: string) => {
    prDeschise.push(branch)
    return 'https://github.com/kelion-team/kelionai/pull/999'
  },
}))
vi.mock('../config.js', () => ({ config: { constructorGeminiModel: 'gemini-test' } }))
// DEVIN E CONSTRUCTORUL când cheia e pusă (22 aug): mâna Aider stă, ordinul intră
// în coadă și dispecerul Devin pleacă IMEDIAT. Mocul poartă comutatorul cheii.
let devinActiv = false
const devinPornit = vi.fn()
vi.mock('./devinConstructor.js', () => ({
  constructorulEsteDevin: () => devinActiv,
  pornesteDevinInFundal: () => {
    if (devinActiv) devinPornit()
    return devinActiv
  },
}))

import { runSelfHeal } from './selfHeal.js'

beforeEach(() => {
  jobs.length = 0
  kv.clear()
  recurring = []
  simptome = []
  ordineMoarte = []
  goluri.length = 0
  plafon = { activ: false, plafon: 10, cheltuit: 0 }
  aiderPropune = null
  prDeschise.length = 0
  devinActiv = false
  devinPornit.mockReset()
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

  // ── ORDINELE MOARTE NU MAI MOR ÎN TĂCERE (owner, 14 aug: „rezolvată
  // definitiv partea cu eșuatul ordinelor") ─────────────────────────────────
  it('un ordin mort primește SEMN o singură dată (alarma nu spamează)', async () => {
    ordineMoarte = [{ id: 42, orderText: 'repară ceva', log: 'eroare: nu am putut', attempts: 3 }]
    await runSelfHeal()
    expect(kv.has('selfheal-ordin-mort:42')).toBe(true)
    const semn = kv.get('selfheal-ordin-mort:42')!
    await runSelfHeal() // aceeași lume — semnul NU se rescrie (alarma nu se repetă)
    expect(kv.get('selfheal-ordin-mort:42')).toBe(semn)
  })

  it('un ordin mort NU naște automat alt ordin (nu ardem aceiași bani orbește)', async () => {
    ordineMoarte = [{ id: 43, orderText: 'x', log: 'eroare de cod: boom', attempts: 3 }]
    const r = await runSelfHeal()
    expect(r.filed).toBe(0)
    expect(jobs).toHaveLength(0)
  })

  // P27 (owner, 15 aug, LEGE: „se rezolva, se arhiveaza, sau se escaladeaza
  // sau se raporteaza la kelion"): mortul se RAPORTEAZĂ în triajul lui Kelion.
  it('un ordin mort se raportează lui Kelion (triajul golurilor), cu motivul', async () => {
    ordineMoarte = [{ id: 44, orderText: 'repară y', log: 'cauza: pana z', attempts: 3 }]
    await runSelfHeal()
    expect(goluri).toHaveLength(1)
    expect(goluri[0].request).toContain('#44')
    expect(goluri[0].reason).toContain('pana z')
  })

  // ── UNICAT — „un doctor pe pacient" (owner, 14 aug: „setezi 1 singur ordin
  // identic, că deschide ZECI" — #235/#236/#237/#248, ~1M tokeni fiecare, pe
  // ACEEAȘI cauză) ──────────────────────────────────────────────────────────
  it('două simptome diferite în ACEEAȘI rulare → UN singur ordin, nu un roi', async () => {
    simptome = [
      simptom('ruta-crapata', 'POST /api/chat: boom', 3, '/api/chat'),
      simptom('chat-mut', 'voce: ușa creierului a picat', 3),
    ]
    const r = await runSelfHeal()
    // primul ordin intră; al doilea vede sursa OCUPATĂ și așteaptă rulările viitoare
    expect(r.filed).toBe(1)
    expect(jobs).toHaveLength(1)
  })

  it('cât timp ordinul unei surse e VIU, sursa nu mai depune nimic — unicat garantat', async () => {
    simptome = [simptom('ruta-crapata', 'POST /api/chat: boom', 3, '/api/chat')]
    await runSelfHeal()
    expect(jobs).toHaveLength(1)
    // apare o eroare NOUĂ (altă semnătură) cât primul ordin încă lucrează:
    simptome = [simptom('ruta-crapata', 'POST /api/plati: alt boom', 3, '/api/plati')]
    await runSelfHeal()
    expect(jobs).toHaveLength(1) // tot UNUL — zgarda a ținut
  })
})

describe('MÂNA AIDER (owner, 16 aug: „pentru autovindecare... il lasi pe el") — întâi Aider, constructorul rezervă', () => {
  it('Aider cu produs REAL (diff + testele TREC) → PR direct, NICIUN ordin la constructor', async () => {
    aiderPropune = { aSchimbat: true, testeTrec: true, branch: 'panou/aider-x1' }
    simptome = [simptom('ruta-crapata', 'POST /api/chat: boom', 3, '/api/chat')]
    const r = await runSelfHeal()
    expect(r.filed).toBe(1)
    expect(prDeschise).toEqual(['panou/aider-x1']) // PR-ul s-a deschis pe ramura lui
    expect(jobs).toHaveLength(0) // constructorul n-a fost chemat
  })

  it('Aider cu teste ROȘII → propunerea NU pleacă; ordinul se depune la constructor (rezerva)', async () => {
    aiderPropune = { aSchimbat: true, testeTrec: false, branch: 'panou/aider-x2' }
    simptome = [simptom('ruta-crapata', 'POST /api/chat: boom', 3, '/api/chat')]
    await runSelfHeal()
    expect(prDeschise).toHaveLength(0)
    expect(jobs).toHaveLength(1)
  })

  it('Aider neinstalat → drumul vechi neatins (ordin la constructor)', async () => {
    aiderPropune = null
    simptome = [simptom('ruta-crapata', 'POST /api/chat: boom', 3, '/api/chat')]
    await runSelfHeal()
    expect(jobs).toHaveLength(1)
  })
})

// ── DEVIN E CONSTRUCTORUL (owner, 22 aug: „Devin handles all constructor tasks") ─
describe('cu cheia Devin pusă — mâna Aider stă, ordinul e al lui Devin, pornit imediat', () => {
  it('Aider NU mai deschide PR chiar dacă ar putea: ordinul intră în coadă + Devin pleacă acum', async () => {
    devinActiv = true
    aiderPropune = { aSchimbat: true, testeTrec: true, branch: 'panou/aider-x9' } // Aider ar fi „reușit"
    simptome = [simptom('ruta-crapata', 'POST /api/chat: boom', 3, '/api/chat')]
    const r = await runSelfHeal()
    expect(r.filed).toBe(1)
    expect(prDeschise).toHaveLength(0) // mâna Aider n-a atins nimic — nu lucrează doi pe aceeași cauză
    expect(jobs).toHaveLength(1) // ordinul e în coadă — al dispecerului Devin
    expect(devinPornit).toHaveBeenCalled() // dispecerul a plecat ACUM, nu la ora buclei
  })

  it('fără cheie Devin, drumul vechi rămâne neatins (Aider întâi) și Devin nu e pornit', async () => {
    aiderPropune = { aSchimbat: true, testeTrec: true, branch: 'panou/aider-x1' }
    simptome = [simptom('ruta-crapata', 'POST /api/chat: boom', 3, '/api/chat')]
    await runSelfHeal()
    expect(prDeschise).toEqual(['panou/aider-x1'])
    expect(devinPornit).not.toHaveBeenCalled()
  })
})
