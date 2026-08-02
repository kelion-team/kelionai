import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  iaSlotDacaLiber,
  elibereazaSlot,
  asteaptaLaCoada,
  poateFolosiRezerva,
  noteazaEsuare,
  eSanatos,
  stareDispecer,
  _resetDispecer,
  REZERVA_CAP_ZILNIC_DEFAULT_USD,
} from './services/dispecer.js'

// ── THE DISPATCHER (Adrian, Aug 1: „ce se întâmplă când vor fi zeci sau
// sute de useri? … să scaleze pe o pungă comună") ────────────────────────────
// Real unit tests over the pure service (no DB, no network): the per-model
// slot limit, the per-minute pacing, the fair queue with timeout, the purse
// threshold, the telemetry — plus the source guard that chat.ts actually
// WIRES the dispatcher (a service nobody calls is a decoration).

beforeEach(() => _resetDispecer())

describe('per-model concurrency + pacing', () => {
  it('refuses the 7th simultaneous call on the same model', () => {
    for (let i = 0; i < 6; i++) expect(iaSlotDacaLiber('m1')).toBe(true)
    expect(iaSlotDacaLiber('m1')).toBe(false)
    // …but another model is untouched.
    expect(iaSlotDacaLiber('m2')).toBe(true)
  })

  it('a release frees the slot immediately', () => {
    for (let i = 0; i < 6; i++) iaSlotDacaLiber('m1')
    expect(iaSlotDacaLiber('m1')).toBe(false)
    elibereazaSlot('m1')
    expect(iaSlotDacaLiber('m1')).toBe(true)
  })

  it('refuses more than 18 starts in the same minute (pacing)', () => {
    for (let i = 0; i < 18; i++) {
      expect(iaSlotDacaLiber('m1')).toBe(true)
      elibereazaSlot('m1') // instant calls — the MINUTE window still counts them
    }
    expect(iaSlotDacaLiber('m1')).toBe(false)
  })

  it('releasing an unknown model never throws and never goes negative', () => {
    expect(() => elibereazaSlot('nimeni')).not.toThrow()
    elibereazaSlot('m1')
    expect(stareDispecer().inZbor).toBe(0)
  })
})

describe('the fair queue', () => {
  it('a waiting turn gets the slot the moment it frees up', async () => {
    for (let i = 0; i < 6; i++) iaSlotDacaLiber('m1')
    const waiting = asteaptaLaCoada(async () => ['m1'], new Set(), 3000)
    setTimeout(() => elibereazaSlot('m1'), 50)
    const got = await waiting
    expect(got).toBe('m1')
    // …and the slot arrives HELD (the queue took it for us).
    expect(stareDispecer().peModele.m1).toBe(6)
  })

  it('returns null after the timeout when nothing frees up', async () => {
    for (let i = 0; i < 6; i++) iaSlotDacaLiber('m1')
    const got = await asteaptaLaCoada(async () => ['m1'], new Set(), 300)
    expect(got).toBeNull()
  })

  it('skips models already tried and takes the first free untried candidate', async () => {
    for (let i = 0; i < 6; i++) iaSlotDacaLiber('m1')
    const got = await asteaptaLaCoada(async () => ['m1', 'm2'], new Set(['m1']), 500)
    // m1 is BOTH tried and busy — m2 must serve.
    expect(got).toBe('m2')
  })
})

describe('the purse threshold', () => {
  it('the reserve is open under the cap and closed at/over it', () => {
    expect(poateFolosiRezerva(0, REZERVA_CAP_ZILNIC_DEFAULT_USD)).toBe(true)
    expect(poateFolosiRezerva(2.99, 3)).toBe(true)
    expect(poateFolosiRezerva(3, 3)).toBe(false)
    expect(poateFolosiRezerva(5, 3)).toBe(false)
  })

  it('the default cap exists and is sane (a few dollars a day)', () => {
    expect(REZERVA_CAP_ZILNIC_DEFAULT_USD).toBeGreaterThan(0)
    expect(REZERVA_CAP_ZILNIC_DEFAULT_USD).toBeLessThanOrEqual(10)
  })
})

describe('failure memory (Adrian: timpii sunt exceptionali de mari)', () => {
  it('a model without failures is healthy', () => {
    expect(eSanatos('m1')).toBe(true)
  })

  it('a failed model becomes sick — for EVERY user, not just this turn', () => {
    noteazaEsuare('m1')
    expect(eSanatos('m1')).toBe(false)
    // …while the rest of the pool stays healthy.
    expect(eSanatos('m2')).toBe(true)
  })

  it('sick models show up in the telemetry', () => {
    noteazaEsuare('m1')
    noteazaEsuare('m2')
    expect(stareDispecer().bolnavi).toBe(2)
  })
})

describe('telemetry', () => {
  it('stareDispecer reports in-flight per model + the queue', () => {
    iaSlotDacaLiber('m1')
    iaSlotDacaLiber('m1')
    iaSlotDacaLiber('m2')
    const s = stareDispecer()
    expect(s.inZbor).toBe(3)
    expect(s.peModele).toEqual({ m1: 2, m2: 1 })
    expect(typeof s.coada).toBe('number')
  })
})

// ── THE WIRING GUARD ─────────────────────────────────────────────────────────
// The dispatcher must be called from the brain loop in chat.ts — slots taken
// before every brain attempt, released on EVERY path, the queue consulted
// when a model is busy, and the reserve counted only on paid fallbacks.
const chat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')

describe('chat.ts chiar folosește dispecerul', () => {
  it('ia slot înainte de încercarea creierului', () => {
    expect(chat).toMatch(/iaSlotDacaLiber\(orchestratorModel\)/)
  })
  it('eliberează slotul pe orice drum (finally)', () => {
    expect(chat).toMatch(/finally \{\s*elibereazaSlot\(slotTinut\)/)
  })
  it('coada e consultată când modelul e ocupat', () => {
    expect(chat).toMatch(/asteaptaLaCoada\(\(\) => listaCandidati\(triedModels\)/)
  })
  it('rezerva e plătită doar la fallback plătit, nu la alegerea userului', () => {
    expect(chat).toMatch(/orchestratorModel !== modelInitial && !orchestratorModel\.endsWith\(':free'\)/)
  })
  it('pool-ul plătit e oprit de pragul pungii', () => {
    expect(chat).toMatch(/if \(await rezervaDeschisa\(\)\)/)
  })
})

describe('latența (Adrian: timpi exceptionali de mari)', () => {
  it('tururile ușoare aleargă în PARALEL — primul răspuns bun câștigă', () => {
    expect(chat).toMatch(/!heavyTurn && !turnHasImage/)
    expect(chat).toMatch(/slice\(0, 3\)/)
    // Aug 2, măsurat live: Promise.all aștepta și concurentul MORT (18,6s la
    // chit-chat). Cursa se închide la primul răspuns bun — vezi services/cursa.ts.
    expect(chat).toMatch(/primulCastigator\(curse\)/)
    expect(chat).not.toMatch(/Promise\.all\(curse\)/)
  })
  it('Gemini direct e PRIMUL concurent (calitatea românei, 1-3s)', () => {
    expect(chat).toMatch(/geminiDirectAvailable\(\) && eSanatos\(`\$\{GEMINI_DIRECT_PREFIX\}\$\{config\.geminiModel\}`\)/)
  })
  it('concurenții NU primesc unelte (fără dublă execuție)', () => {
    expect(chat).toMatch(/runOrchestrator\(id, orMsgs, \[\], execTool, \{ maxTokens: 800 \}\)/)
  })
  it('modelele moarte se notează bolnav în bucla secvențială', () => {
    expect(chat).toMatch(/returned empty — silent rotation`\)\s*\n\s*noteazaEsuare/)
    expect(chat).toMatch(/silent rotation`\)\s*\n\s*noteazaEsuare/)
  })
  it('candidații sănătoși trec în fața bolnavilor', () => {
    expect(chat).toMatch(/sanatosi[\s\S]{0,120}bolnavi/)
  })
})
