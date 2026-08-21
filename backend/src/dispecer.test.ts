import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  iaSlotDacaLiber,
  elibereazaSlot,
  asteaptaLaCoada,
  noteazaEsuare,
  eSanatos,
  stareDispecer,
  _resetDispecer,
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

// (Testele „the purse threshold" au fost ȘTERSE, 3 aug — punga de rezervă pe
// modele plătite a fost extirpată împreună cu OpenRouter: nu mai există niciun
// fallback plătit, deci nici prag de pungă.)

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
// when the model is busy.
// (3 aug — extirparea OpenRouter: rotația/cursa pe alți furnizori și punga de
// rezervă au dispărut; creierul e Gemini-only. Gardurile de mai jos pinuiează
// EXACT noua formă: reîncercări pe ACELAȘI creier Gemini, apoi mesajul neutru.)
const chat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')

describe('chat.ts chiar folosește dispecerul (Gemini-only)', () => {
  it('ia slot înainte de încercarea creierului — pe modelul EFECTIV (escaladarea ask_brain mută rundele pe alt model; slotul trebuie să-l urmeze, registrul backend #1)', () => {
    expect(chat).toMatch(/const modelEfectiv = \(\): string => escaladare\.model \|\| orchestratorModel/)
    expect(chat).toMatch(/const modelIncercare = modelEfectiv\(\)/)
    expect(chat).toMatch(/iaSlotDacaLiber\(modelIncercare\)/)
  })
  it('eliberează slotul pe orice drum (finally)', () => {
    expect(chat).toMatch(/finally \{\s*elibereazaSlot\(slotTinut\)/)
  })
  it('coada e consultată când creierul Gemini e ocupat — pe ACELAȘI model efectiv, nu pe alt furnizor', () => {
    expect(chat).toMatch(/asteaptaLaCoada\(async \(\) => \[modelIncercare\]/)
    // …și plasa (profund↔rapid) tot pe modelul efectiv își ia slotul.
    expect(chat).toMatch(/asteaptaLaCoada\(async \(\) => \[modelPlasa\]/)
  })
  it('NICIO rotație pe alt furnizor: pool-ul de candidați și rezerva plătită au dispărut din cod', () => {
    expect(chat).not.toMatch(/listaCandidati|rezervaDeschisa|adaugaLaRezerva|getCatalog|openrouterChat/)
  })
  // (Blocurile „pool-ul plătit e oprit de pragul pungii" și „latența/cursa doar
  // Gemini" au fost absorbite de extirparea totală, 3 aug seara: cursa, pool-ul
  // de candidați și punga de rezervă NU MAI EXISTĂ în cod — gardul de mai sus
  // le pinuiează absența, iar reîncercările de mai jos pinuiează noua formă.)
  it('un răspuns gol sau o eroare se notează (telemetrie) pe modelul care CHIAR a rulat și se reîncearcă pe Gemini', () => {
    expect(chat).toMatch(/returned empty — reîncercare/)
    expect(chat).toMatch(/noteazaEsuare\(modelIncercare\)/)
    // Telemetria nu mai are voie să dea vina pe modelul de PORNIRE.
    expect(chat).not.toMatch(/noteazaEsuare\(orchestratorModel\)/)
  })
  it('profundul epuizat NU se re-încearcă tot pe profund — cade pe o față rapidă REALĂ (a treia treaptă modelRapidDirect pe turele grele, unde plasa veche era moartă)', () => {
    expect(chat).toMatch(/modelEfectiv\(\) === profund/)
    expect(chat).toMatch(/PROFUNDUL EPUIZAT/)
    expect(chat).toMatch(/orchestratorModel !== profund \? orchestratorModel : modelRapidDirect\(\)/)
  })
  it('fapta deja executată oprește orice reluare completă a turei (registrul backend #2) — și bucla, și plasele', () => {
    expect(chat).toMatch(/let faptaInIncercareEsuata = false/)
    expect(chat).toMatch(/const unelteLaStart = unelteIncercate\.length/)
    // ambele plase citesc flag-ul
    const plaseGardate = chat.match(/!faptaInIncercareEsuata/g) ?? []
    expect(plaseGardate.length).toBeGreaterThanOrEqual(2)
  })
  it('la epuizarea încercărilor tura se încheie ONEST (mesajul neutru din catch), nu pe alt creier', () => {
    expect(chat).toMatch(/brain_gemini_exhausted/)
    expect(chat).toMatch(/Încearcă din nou în câteva secunde\./)
  })
})
